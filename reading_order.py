import math
from statistics import median

RELIABLE_WIDTH_RATIO = 1.3
ANGLE_THRESHOLD_DEG = 20.0
PERP_DIST_FACTOR = 0.65
MERGE_ANGLE_THRESHOLD_DEG = 12.0
MERGE_PERP_DIST_FACTOR = 0.35
PARAGRAPH_GAP_MEDIAN_FACTOR = 1.7
PARAGRAPH_GAP_HEIGHT_FACTOR = 1.8
MIN_DETECTIONS_FOR_PROJECTION = 10
MIN_RELIABLE_FOR_PROJECTION = 6

def _angle_deg(p_from, p_to):
    return math.degrees(math.atan2(p_to[1] - p_from[1], p_to[0] - p_from[0]))

def normalize_angle(angle):
    while angle > 90:
        angle -= 180
    while angle <= -90:
        angle += 180
    return angle


def angle_diff(a, b):
    return abs(normalize_angle(a - b))


def analyze_box(bbox):
    tl, tr, br, bl = [(float(p[0]), float(p[1])) for p in bbox]
    cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4.0
    cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4.0

    top_len = math.hypot(tr[0] - tl[0], tr[1] - tl[1])
    bot_len = math.hypot(br[0] - bl[0], br[1] - bl[1])
    left_len = math.hypot(bl[0] - tl[0], bl[1] - tl[1])
    right_len = math.hypot(br[0] - tr[0], br[1] - tr[1])

    width = max((top_len + bot_len) / 2.0, 1e-6)
    height = max((left_len + right_len) / 2.0, 1e-6)

    top_angle = _angle_deg(tl, tr)
    bot_angle = _angle_deg(bl, br)
    angle = normalize_angle((top_angle + bot_angle) / 2.0)

    return {
        "centroid": (cx, cy),
        "width": width,
        "height": height,
        "angle": angle,
    }


def estimate_global_skew(detections):
    reliable = [d for d in detections if d["width"] >= RELIABLE_WIDTH_RATIO * d["height"]]
    pool = reliable if reliable else detections
    if not pool:
        return 0.0

    pairs = sorted((d["angle"], d["width"]) for d in pool)
    total = sum(w for _, w in pairs)
    if total <= 0:
        return median(a for a, _ in pairs)
    cum = 0.0
    for a, w in pairs:
        cum += w
        if cum >= total / 2.0:
            return a
    return pairs[-1][0]


def angle_spread(detections):
    reliable = [d for d in detections if d["width"] >= RELIABLE_WIDTH_RATIO * d["height"]]
    pool = reliable if reliable else detections
    if len(pool) < 2:
        return 0.0
    angles = [d["angle"] for d in pool]
    return max(angles) - min(angles)


def estimate_skew_by_projection(detections, angle_range=40.0, coarse_step=1.0):
    centroids = [d["centroid"] for d in detections]
    if len(centroids) < 3:
        return 0.0

    avg_height = sum(d["height"] for d in detections) / len(detections)
    bin_size = max(avg_height * 0.5, 2.0)

    def score_angle(angle_deg):
        theta = math.radians(angle_deg)
        nx, ny = -math.sin(theta), math.cos(theta)
        projected = [cx * nx + cy * ny for cx, cy in centroids]
        lo, hi = min(projected), max(projected)
        n_bins = max(int((hi - lo) / bin_size) + 1, 1)
        bins = [0] * n_bins
        for p in projected:
            idx = min(int((p - lo) / bin_size), n_bins - 1)
            bins[idx] += 1
        return sum(b * b for b in bins)

    def search(lo, hi, step):
        best_angle, best_score = 0.0, -1.0
        angle = lo
        while angle <= hi:
            s = score_angle(angle)
            if s > best_score:
                best_score, best_angle = s, angle
            angle += step
        return best_angle

    coarse_best = search(-angle_range, angle_range, coarse_step)
    fine_best = search(coarse_best - coarse_step, coarse_best + coarse_step, 0.1)
    return fine_best


def estimate_global_angle(detections):
    reliable_count = sum(1 for d in detections if d["width"] >= RELIABLE_WIDTH_RATIO * d["height"])
    if len(detections) < MIN_DETECTIONS_FOR_PROJECTION or reliable_count < MIN_RELIABLE_FOR_PROJECTION:
        return estimate_global_skew(detections)
    return estimate_skew_by_projection(detections)


def _project(centroid, ref_point, angle_deg):
    theta = math.radians(angle_deg)
    dx = centroid[0] - ref_point[0]
    dy = centroid[1] - ref_point[1]
    ux, uy = math.cos(theta), math.sin(theta)
    nx, ny = -math.sin(theta), math.cos(theta)
    return (dx * nx + dy * ny), (dx * ux + dy * uy)  # (perp, along)


def _recompute_cluster_stats(cl):
    reliable_members = [m for m in cl["members"] if m["width"] >= RELIABLE_WIDTH_RATIO * m["height"]]
    pool = reliable_members if reliable_members else cl["members"]
    total_w = sum(m["width"] for m in pool)
    if total_w > 0:
        cl["angle"] = sum(m["angle"] * m["width"] for m in pool) / total_w
    n = len(cl["members"])
    cl["ref"] = (
        sum(m["centroid"][0] for m in cl["members"]) / n,
        sum(m["centroid"][1] for m in cl["members"]) / n,
    )
    cl["heights"] = [m["height"] for m in cl["members"]]


def _is_own_angle_reliable(d, global_angle):
    return (d["width"] >= RELIABLE_WIDTH_RATIO * d["height"]) and not (
        abs(d["angle"]) < 1.0 and abs(global_angle) > 2.0
    )


def _place_detection(d, clusters, dist_thresh, require_angle_match):
    """Find the best existing cluster for one detection, or None if it
    should seed a new cluster."""
    cx, cy = d["centroid"]
    best_idx, best_score = None, None
    for i, cl in enumerate(clusters):
        perp, _along = _project((cx, cy), cl["ref"], cl["angle"])
        if abs(perp) > dist_thresh:
            continue
        if require_angle_match and angle_diff(d["angle"], cl["angle"]) > ANGLE_THRESHOLD_DEG:
            continue
        score = abs(perp) / dist_thresh
        if best_score is None or score < best_score:
            best_score, best_idx = score, i
    return best_idx


def cluster_lines(detections, global_angle, ref_height):
    theta = math.radians(global_angle)
    nx, ny = -math.sin(theta), math.cos(theta)

    def perp_position(d):
        return d["centroid"][0] * nx + d["centroid"][1] * ny

    dist_thresh = PERP_DIST_FACTOR * ref_height
    clusters = []

    reliable = sorted(
        (d for d in detections if _is_own_angle_reliable(d, global_angle)),
        key=perp_position,
    )
    for d in reliable:
        idx = _place_detection(d, clusters, dist_thresh, require_angle_match=True)
        if idx is None:
            clusters.append({
                "angle": d["angle"],
                "ref": d["centroid"],
                "members": [d],
                "heights": [d["height"]],
            })
        else:
            cl = clusters[idx]
            cl["members"].append(d)
            _recompute_cluster_stats(cl)

    unreliable = sorted(
        (d for d in detections if not _is_own_angle_reliable(d, global_angle)),
        key=perp_position,
    )
    for d in unreliable:
        idx = _place_detection(d, clusters, dist_thresh, require_angle_match=False)
        if idx is None:
            clusters.append({
                "angle": global_angle,
                "ref": d["centroid"],
                "members": [d],
                "heights": [d["height"]],
            })
        else:
            cl = clusters[idx]
            cl["members"].append(d)
            _recompute_cluster_stats(cl)

    return clusters


def _along_ranges_overlap(a, b, angle_deg, min_overlap_ratio=0.3):
    def along_span(cl):
        alongs = [_project(m["centroid"], cl["ref"], angle_deg)[1] for m in cl["members"]]
        return min(alongs), max(alongs)

    a0, a1 = along_span(a)
    b0, b1 = along_span(b)
    overlap = min(a1, b1) - max(a0, b0)
    if overlap <= 0:
        return False
    shorter = min(a1 - a0, b1 - b0)
    if shorter <= 0:
        return False
    return (overlap / shorter) >= min_overlap_ratio


def merge_compatible_clusters(clusters, ref_height):
    dist_thresh = MERGE_PERP_DIST_FACTOR * ref_height
    merged = True
    while merged and len(clusters) > 1:
        merged = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                a, b = clusters[i], clusters[j]
                if angle_diff(a["angle"], b["angle"]) > MERGE_ANGLE_THRESHOLD_DEG:
                    continue
                perp_ab, _ = _project(b["ref"], a["ref"], a["angle"])
                if abs(perp_ab) > dist_thresh:
                    continue
                if _along_ranges_overlap(a, b, a["angle"]):
                    continue
                a["members"].extend(b["members"])
                _recompute_cluster_stats(a)
                del clusters[j]
                merged = True
                break
            if merged:
                break
    return clusters


def order_cluster_members(cluster):
    theta = math.radians(cluster["angle"])
    ux, uy = math.cos(theta), math.sin(theta)
    return sorted(cluster["members"], key=lambda m: m["centroid"][0] * ux + m["centroid"][1] * uy)


def order_clusters(clusters, global_angle):
    theta = math.radians(global_angle)
    nx, ny = -math.sin(theta), math.cos(theta)
    return sorted(clusters, key=lambda cl: cl["ref"][0] * nx + cl["ref"][1] * ny)


def line_confidence(cluster):
    members = cluster["members"]
    ocr_conf = sum(m["confidence"] for m in members) / len(members)

    avg_h = sum(cluster["heights"]) / len(cluster["heights"])
    residuals = []
    for m in members:
        perp, _along = _project(m["centroid"], cluster["ref"], cluster["angle"])
        residuals.append(abs(perp) / max(avg_h, 1e-6))
    geom_fit = 1.0 - min(1.0, sum(residuals) / len(residuals))

    return round(0.7 * ocr_conf + 0.3 * max(geom_fit, 0.0), 3)


def reconstruct_reading_order(easyocr_results):
    if not easyocr_results:
        return "", {
            "global_skew_deg": 0.0,
            "angle_spread_deg": 0.0,
            "uniform_rotation": True,
            "line_count": 0,
            "word_count": 0,
            "lines": [],
        }

    detections = []
    for bbox, text, conf in easyocr_results:
        feats = analyze_box(bbox)
        detections.append({"text": text, "confidence": float(conf), **feats})

    global_angle = estimate_global_angle(detections)
    spread = angle_spread(detections)
    ref_height = median(d["height"] for d in detections)

    clusters = cluster_lines(detections, global_angle, ref_height)
    clusters = merge_compatible_clusters(clusters, ref_height)
    ordered_clusters = order_clusters(clusters, global_angle)
    theta = math.radians(global_angle)
    nx, ny = -math.sin(theta), math.cos(theta)
    positions = [cl["ref"][0] * nx + cl["ref"][1] * ny for cl in ordered_clusters]

    all_heights = [h for cl in ordered_clusters for h in cl["heights"]]
    avg_height = sum(all_heights) / len(all_heights) if all_heights else 20.0

    gaps = [positions[i + 1] - positions[i] for i in range(len(positions) - 1)]
    med_gap = median(gaps) if gaps else avg_height * 1.4
    para_break_after = set()
    for i, g in enumerate(gaps):
        threshold = max(med_gap * PARAGRAPH_GAP_MEDIAN_FACTOR, avg_height * PARAGRAPH_GAP_HEIGHT_FACTOR)
        if g > threshold:
            para_break_after.add(i)

    lines_meta = []
    output_parts = []
    for i, cl in enumerate(ordered_clusters):
        members = order_cluster_members(cl)
        line_text = " ".join(m["text"] for m in members)
        output_parts.append(line_text)
        lines_meta.append({
            "text": line_text,
            "angle_deg": round(cl["angle"], 2),
            "word_count": len(members),
            "confidence": line_confidence(cl),
            "centroid": [round(cl["ref"][0], 1), round(cl["ref"][1], 1)],
        })
        if i in para_break_after:
            output_parts.append("")

    full_text = "\n".join(output_parts)

    debug_meta = {
        "global_skew_deg": round(global_angle, 2),
        "box_angle_median_deg": round(estimate_global_skew(detections), 2),
        "angle_spread_deg": round(spread, 2),
        "uniform_rotation": spread < 15.0,
        "ref_text_height_px": round(ref_height, 1),
        "line_count": len(ordered_clusters),
        "word_count": len(detections),
        "avg_line_confidence": round(sum(l["confidence"] for l in lines_meta) / len(lines_meta), 3) if lines_meta else 0.0,
        "lines": lines_meta,
    }

    return full_text, debug_meta


def detect_redaction_boxes(image_bytes, existing_results, darkness_threshold=40,
                            min_area_px=300, min_side_px=15, fill_ratio_threshold=0.55):
    
    import numpy as np
    import cv2

    file_bytes = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(file_bytes, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return []

    dark_mask = (img < darkness_threshold).astype(np.uint8)
    n_labels, _labels, stats, _centroids = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)

    def bbox_range(bbox):
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        return min(xs), min(ys), max(xs), max(ys)

    text_ranges = [bbox_range(bbox) for bbox, _text, _conf in existing_results]

    redactions = []
    for label in range(1, n_labels):  # label 0 is the background
        x, y, w, h, area = stats[label]
        if area < min_area_px or w < min_side_px or h < min_side_px:
            continue
        fill_ratio = area / float(w * h)
        if fill_ratio < fill_ratio_threshold:
            continue
        cx, cy = x + w / 2.0, y + h / 2.0
        if any(bx0 <= cx <= bx1 and by0 <= cy <= by1 for bx0, by0, bx1, by1 in text_ranges):
            continue
        bbox = [[float(x), float(y)], [float(x + w), float(y)],
                [float(x + w), float(y + h)], [float(x), float(y + h)]]
        redactions.append((bbox, "\u2588\u2588", 1.0))
    return redactions

