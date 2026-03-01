"""
app.py — Backend cho ứng dụng trực quan hóa External Merge Sort

API Endpoints:
  GET  /                : Serve giao diện chính
  POST /api/sort        : Nhận cấu hình (mảng dữ liệu, B buffer pages, chế độ),
                          trả về animation_steps (mỗi step là hành động nguyên tử).

Các action trong animation_steps:
  - "move"     : Di chuyển phần tử giữa các vùng  (disk → ram, ram → run, …)
  - "compare"  : Highlight 2 phần tử đang so sánh
  - "freeze"   : Đánh dấu phần tử bị đóng băng (Repacking mode)
  - "unfreeze" : Gỡ đóng băng khi bắt đầu Run mới
  - "swap"     : Hoán vị 2 phần tử trong RAM
  - "label"    : Cập nhật label (Pass, I/O counters)
  - "new_run"  : Bắt đầu run mới ở Temp Disk
  - "highlight": Highlight phần tử (vd: min trong heap)
  - "clear_highlight" : Xóa highlight
  - "set_output_buffer": Đánh dấu một page là output buffer
"""

import math
import heapq
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# =====================================================================
# Biến đếm ID duy nhất cho mỗi phần tử dữ liệu
# =====================================================================
_element_counter = 0


def _next_id():
    """Trả về ID duy nhất cho phần tử dữ liệu."""
    global _element_counter
    _element_counter += 1
    return f"item_{_element_counter}"


def _reset_ids():
    global _element_counter
    _element_counter = 0


# =====================================================================
# ROUTE: Trang chủ
# =====================================================================
@app.route("/")
def index():
    return render_template("index.html")


# =====================================================================
# API: Chạy External Merge Sort
# =====================================================================
@app.route("/api/sort", methods=["POST"])
def sort_api():
    """
    Request JSON:
      {
        "data": [5.0, 3.2, 8.1, ...],   // Mảng số thực đầu vào
        "B": 3,                           // Số Buffer Pages trong RAM
        "mode": "standard" | "repacking"  // Chế độ sắp xếp
      }

    Response JSON:
      {
        "animation_steps": [...],
        "elements": [ { "id": "item_1", "value": 5.0 }, ... ],
        "B": 3,
        "mode": "standard",
        "num_runs_pass0": ...,
        "total_passes": ...
      }
    """
    body = request.get_json()
    data = [float(x) for x in body.get("data", [])]
    B = int(body.get("B", 3))
    mode = body.get("mode", "standard")

    if not data:
        return jsonify({"error": "Mảng dữ liệu rỗng."}), 400
    if B < 3:
        return jsonify({"error": "B phải >= 3 (ít nhất 2 Input buffers + 1 Output buffer để merge)."}), 400

    _reset_ids()

    # Gán ID cho mỗi phần tử
    elements = [{"id": _next_id(), "value": v} for v in data]

    if mode == "repacking":
        steps, runs = _pass0_repacking(elements, B)
    else:
        steps, runs = _pass0_standard(elements, B)

    num_runs_pass0 = len(runs)

    # --- Merge passes ---
    merge_steps, final_output = _merge_passes(runs, B)
    steps.extend(merge_steps)

    # Tính tổng số passes
    if num_runs_pass0 <= 1:
        total_passes = 1
    else:
        total_passes = 1 + math.ceil(math.log(num_runs_pass0) / math.log(B - 1)) if num_runs_pass0 > 1 else 1

    return jsonify({
        "animation_steps": steps,
        "elements": [{"id": e["id"], "value": e["value"]} for e in elements],
        "B": B,
        "mode": mode,
        "num_runs_pass0": num_runs_pass0,
        "total_passes": total_passes,
    })


# =====================================================================
# PASS 0 — STANDARD: Đọc đầy B pages, Sort trong RAM, ghi ra Run
# =====================================================================
def _pass0_standard(elements, B):
    """
    Pha 0 (Standard): Chia input thành các chunk kích thước B,
    sort mỗi chunk trong RAM rồi ghi ra Run trên ổ đĩa tạm.
    """
    steps = []
    runs = []  # Mỗi run là list các {id, value}
    io_reads = 0
    io_writes = 0
    n = len(elements)
    run_index = 0

    steps.append({"action": "label", "key": "pass", "value": "Pass 0 — Tạo Sorted Runs (Standard)"})

    for start in range(0, n, B):
        end = min(start + B, n)
        chunk = elements[start:end]

        # Bước 1: Đọc từng phần tử vào RAM pages
        for i, elem in enumerate(chunk):
            io_reads += 1
            steps.append({
                "action": "move",
                "element_id": elem["id"],
                "value": elem["value"],
                "from": "disk",
                "from_index": start + i,
                "to": f"ram_page_{i}",
                "description": f"Đọc {elem['value']} từ Disk vào RAM Page {i}"
            })
        steps.append({"action": "label", "key": "io_reads", "value": io_reads})

        # Bước 2: Sort (dùng selection sort để tạo compare/swap animations)
        ram = list(chunk)
        sort_steps = _animated_sort(ram)
        steps.extend(sort_steps)

        # Bước 3: Tạo Run mới trên Temp Disk
        steps.append({
            "action": "new_run",
            "run_index": run_index,
            "size": len(ram),
            "description": f"Tạo Run #{run_index} trên Temp Disk"
        })

        # Bước 4: Ghi từng phần tử xuống Run (Temp Disk)
        run_data = []
        for i, elem in enumerate(ram):
            io_writes += 1
            steps.append({
                "action": "move",
                "element_id": elem["id"],
                "value": elem["value"],
                "from": f"ram_page_{i}",
                "to": "temp_disk",
                "to_run": run_index,
                "to_index": i,
                "description": f"Ghi {elem['value']} ra Run #{run_index} vị trí {i}"
            })
            run_data.append({"id": elem["id"], "value": elem["value"]})

        steps.append({"action": "label", "key": "io_writes", "value": io_writes})
        runs.append(run_data)
        run_index += 1

        # Xóa RAM (chuẩn bị cho chunk tiếp)
        steps.append({"action": "clear_ram"})

    return steps, runs


# =====================================================================
# PASS 0 — REPACKING (Replacement Selection) với Min-Heap
# =====================================================================
def _pass0_repacking(elements, B):
    """
    Pha 0 (Repacking / Replacement Selection):
    Sử dụng Min-Heap kích thước B. Nếu phần tử nạp mới nhỏ hơn phần tử
    vừa xuất ra, đánh dấu Frozen. Khi toàn bộ heap bị Frozen → Run mới.
    """
    steps = []
    runs = []
    io_reads = 0
    io_writes = 0

    steps.append({"action": "label", "key": "pass", "value": "Pass 0 — Tạo Sorted Runs (Repacking)"})

    n = len(elements)
    # Heap entries: (value, is_frozen_flag, element_dict)
    # is_frozen_flag: 0 = active, 1 = frozen (đảm bảo active được pop trước frozen)
    heap = []
    input_ptr = 0  # Con trỏ đọc từ input
    current_run = []
    run_index = 0
    last_output = float("-inf")
    ram_state = {}  # page_index -> element

    # --- Bước 1: Nạp đầy B phần tử vào heap ---
    initial_count = min(B, n)
    for i in range(initial_count):
        elem = elements[input_ptr]
        input_ptr += 1
        io_reads += 1
        steps.append({
            "action": "move",
            "element_id": elem["id"],
            "value": elem["value"],
            "from": "disk",
            "from_index": input_ptr - 1,
            "to": f"ram_page_{i}",
            "description": f"Nạp {elem['value']} vào RAM Page {i}"
        })
        heapq.heappush(heap, (0, elem["value"], i, elem))  # (frozen_flag, value, page, elem)
        ram_state[i] = elem

    steps.append({"action": "label", "key": "io_reads", "value": io_reads})

    # Tạo Run #0
    steps.append({
        "action": "new_run",
        "run_index": run_index,
        "size": 0,
        "description": f"Bắt đầu Run #{run_index}"
    })

    # --- Bước 2: Lặp cho đến khi heap hết ---
    run_write_pos = 0

    while heap:
        # Lấy phần tử nhỏ nhất (ưu tiên active trước frozen)
        frozen_flag, val, page_idx, elem = heapq.heappop(heap)

        # Nếu tất cả đều Frozen (phần tử pop ra cũng frozen) → bắt đầu Run mới
        if frozen_flag == 1:
            # Lưu run hiện tại
            if current_run:
                runs.append(current_run)

            run_index += 1
            current_run = []
            run_write_pos = 0
            last_output = float("-inf")

            # Unfreeze tất cả
            steps.append({
                "action": "unfreeze_all",
                "description": "Tất cả phần tử đã Frozen → Bắt đầu Run mới, bỏ đóng băng tất cả."
            })

            # Tạo Run mới
            steps.append({
                "action": "new_run",
                "run_index": run_index,
                "size": 0,
                "description": f"Bắt đầu Run #{run_index}"
            })

            # Re-insert phần tử này dưới dạng active và rebuild heap
            new_heap = [(0, v, p, e) for (_, v, p, e) in heap]
            new_heap.append((0, val, page_idx, elem))
            heapq.heapify(new_heap)
            heap = new_heap
            continue

        # Highlight phần tử min
        steps.append({
            "action": "highlight",
            "element_id": elem["id"],
            "color": "green",
            "description": f"Min-Heap pop: {elem['value']}"
        })

        # Ghi phần tử ra Run hiện tại
        io_writes += 1
        steps.append({
            "action": "move",
            "element_id": elem["id"],
            "value": elem["value"],
            "from": f"ram_page_{page_idx}",
            "to": "temp_disk",
            "to_run": run_index,
            "to_index": run_write_pos,
            "description": f"Ghi {elem['value']} ra Run #{run_index}"
        })
        current_run.append({"id": elem["id"], "value": elem["value"]})
        run_write_pos += 1
        last_output = val
        steps.append({"action": "label", "key": "io_writes", "value": io_writes})

        # Nạp phần tử mới từ input (nếu còn)
        if input_ptr < n:
            new_elem = elements[input_ptr]
            input_ptr += 1
            io_reads += 1
            steps.append({
                "action": "move",
                "element_id": new_elem["id"],
                "value": new_elem["value"],
                "from": "disk",
                "from_index": input_ptr - 1,
                "to": f"ram_page_{page_idx}",
                "description": f"Nạp {new_elem['value']} vào RAM Page {page_idx} thay thế"
            })
            steps.append({"action": "label", "key": "io_reads", "value": io_reads})

            # Kiểm tra Frozen: nếu giá trị mới < phần tử vừa xuất → Freeze
            if new_elem["value"] < last_output:
                steps.append({
                    "action": "freeze",
                    "element_id": new_elem["id"],
                    "description": f"{new_elem['value']} < {last_output} (just output) → Frozen!"
                })
                heapq.heappush(heap, (1, new_elem["value"], page_idx, new_elem))
            else:
                steps.append({
                    "action": "compare",
                    "elements": [elem["id"], new_elem["id"]],
                    "description": f"{new_elem['value']} >= {last_output} → Active, thêm vào heap."
                })
                heapq.heappush(heap, (0, new_elem["value"], page_idx, new_elem))

            ram_state[page_idx] = new_elem

    # Lưu run cuối
    if current_run:
        runs.append(current_run)

    steps.append({"action": "clear_ram"})
    return steps, runs


# =====================================================================
# MERGE PASSES: Trộn B-1 đường (Input Buffers) + 1 Output Buffer
# =====================================================================
def _merge_passes(runs, B):
    """
    Thực hiện merge multi-pass. Mỗi pass trộn tối đa (B-1) runs thành 1 run mới.
    Lặp lại cho đến khi chỉ còn 1 run duy nhất (kết quả cuối cùng).
    """
    steps = []
    pass_num = 1
    io_reads = 0
    io_writes = 0

    if len(runs) <= 1:
        # Chỉ có 1 run → copy trực tiếp ra output
        if runs:
            steps.append({"action": "label", "key": "pass", "value": "Kết quả — 1 Run duy nhất"})
            for i, elem in enumerate(runs[0]):
                steps.append({
                    "action": "move",
                    "element_id": elem["id"],
                    "value": elem["value"],
                    "from": "temp_disk",
                    "from_run": 0,
                    "from_index": i,
                    "to": "output",
                    "to_index": i,
                    "description": f"Copy {elem['value']} → Output"
                })
        return steps, runs[0] if runs else []

    while len(runs) > 1:
        steps.append({
            "action": "label",
            "key": "pass",
            "value": f"Pass {pass_num} — Merge (B-1={B-1} runs tại mỗi thời điểm)"
        })

        new_runs = []
        merge_fan_in = B - 1  # Số runs trộn đồng thời (B-1 Input Buffers)

        if merge_fan_in < 2:
            raise ValueError("Cấu hình B không hợp lệ cho merge: cần B >= 3.")

        for group_start in range(0, len(runs), merge_fan_in):
            group_end = min(group_start + merge_fan_in, len(runs))
            group = runs[group_start:group_end]

            if len(group) == 1:
                new_runs.append(group[0])
                continue

            # Merge nhóm runs này
            merge_result, merge_steps, r, w = _merge_group(
                group, group_start, B, pass_num, io_reads, io_writes
            )
            io_reads = r
            io_writes = w
            steps.extend(merge_steps)
            new_runs.append(merge_result)

        # Chuẩn bị cho pass tiếp theo: runs mới thay thế runs cũ
        steps.append({
            "action": "promote_runs",
            "new_run_count": len(new_runs),
            "description": f"Pass {pass_num} xong → {len(new_runs)} runs mới."
        })

        runs = new_runs
        pass_num += 1

    # Copy run cuối cùng ra Output
    if runs:
        steps.append({"action": "label", "key": "pass", "value": "Copy kết quả cuối → Output"})
        for i, elem in enumerate(runs[0]):
            steps.append({
                "action": "move",
                "element_id": elem["id"],
                "value": elem["value"],
                "from": "temp_disk",
                "from_run": 0,
                "from_index": i,
                "to": "output",
                "to_index": i,
                "description": f"Copy {elem['value']} → Output vị trí {i}"
            })

    return steps, runs[0] if runs else []


def _merge_group(group, group_start, B, pass_num, io_reads, io_writes):
    """
    Trộn một nhóm runs (tối đa B-1 runs) vào 1 run mới.
    Sử dụng B-1 Input Buffer Pages + 1 Output Buffer Page.
    """
    steps = []
    k = len(group)
    output_buffer_page = B - 1  # Page cuối dùng làm Output Buffer

    steps.append({
        "action": "set_output_buffer",
        "page_index": output_buffer_page,
        "description": f"RAM Page {output_buffer_page} là Output Buffer"
    })

    # Con trỏ đọc cho mỗi run trong nhóm
    ptrs = [0] * k
    result = []

    # Min-heap: (value, run_idx, element)
    heap = []

    # Nạp phần tử đầu tiên của mỗi run vào Input Buffer
    for i in range(k):
        if ptrs[i] < len(group[i]):
            elem = group[i][ptrs[i]]
            ptrs[i] += 1
            io_reads += 1
            steps.append({
                "action": "move",
                "element_id": elem["id"],
                "value": elem["value"],
                "from": "temp_disk",
                "from_run": group_start + i,
                "from_index": ptrs[i] - 1,
                "to": f"ram_page_{i}",
                "description": f"Đọc {elem['value']} từ Run #{group_start + i} → Input Buffer (Page {i})"
            })
            heapq.heappush(heap, (elem["value"], i, elem))

    steps.append({"action": "label", "key": "io_reads", "value": io_reads})

    # Merge
    output_run_idx = group_start  # Ghi đè run cùng vị trí (đơn giản hóa)
    write_pos = 0

    while heap:
        val, from_run_local, elem = heapq.heappop(heap)

        # Highlight phần tử min
        steps.append({
            "action": "highlight",
            "element_id": elem["id"],
            "color": "green",
            "description": f"Min = {elem['value']} (từ Run #{group_start + from_run_local})"
        })

        # Di chuyển vào Output Buffer
        steps.append({
            "action": "move",
            "element_id": elem["id"],
            "value": elem["value"],
            "from": f"ram_page_{from_run_local}",
            "to": f"ram_page_{output_buffer_page}",
            "description": f"→ Output Buffer (Page {output_buffer_page})"
        })

        # Flush Output Buffer → Temp Disk (mỗi lần 1 phần tử cho animation rõ)
        io_writes += 1
        steps.append({
            "action": "move",
            "element_id": elem["id"],
            "value": elem["value"],
            "from": f"ram_page_{output_buffer_page}",
            "to": "merge_output",
            "to_run": output_run_idx,
            "to_index": write_pos,
            "description": f"Ghi {elem['value']} → Merge Output vị trí {write_pos}"
        })
        result.append({"id": elem["id"], "value": elem["value"]})
        write_pos += 1
        steps.append({"action": "label", "key": "io_writes", "value": io_writes})

        # Nạp phần tử tiếp từ run tương ứng
        if ptrs[from_run_local] < len(group[from_run_local]):
            next_elem = group[from_run_local][ptrs[from_run_local]]
            ptrs[from_run_local] += 1
            io_reads += 1
            steps.append({
                "action": "move",
                "element_id": next_elem["id"],
                "value": next_elem["value"],
                "from": "temp_disk",
                "from_run": group_start + from_run_local,
                "from_index": ptrs[from_run_local] - 1,
                "to": f"ram_page_{from_run_local}",
                "description": f"Đọc tiếp {next_elem['value']} từ Run #{group_start + from_run_local}"
            })
            steps.append({"action": "label", "key": "io_reads", "value": io_reads})
            heapq.heappush(heap, (next_elem["value"], from_run_local, next_elem))

    steps.append({"action": "clear_ram"})
    return result, steps, io_reads, io_writes


# =====================================================================
# ANIMATED SORT: Selection Sort với compare/swap steps
# =====================================================================
def _animated_sort(arr):
    """
    Selection sort trên mảng arr (list of {id, value} dicts).
    Tạo compare/swap animation steps.
    """
    steps = []
    n = len(arr)
    for i in range(n):
        min_idx = i
        for j in range(i + 1, n):
            steps.append({
                "action": "compare",
                "elements": [arr[min_idx]["id"], arr[j]["id"]],
                "description": f"So sánh {arr[min_idx]['value']} vs {arr[j]['value']}"
            })
            if arr[j]["value"] < arr[min_idx]["value"]:
                min_idx = j
        if min_idx != i:
            steps.append({
                "action": "swap",
                "element_a": arr[i]["id"],
                "page_a": i,
                "element_b": arr[min_idx]["id"],
                "page_b": min_idx,
                "description": f"Hoán vị {arr[i]['value']} ↔ {arr[min_idx]['value']}"
            })
            arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return steps


# =====================================================================
# CHẠY SERVER
# =====================================================================
if __name__ == "__main__":
    print("=" * 50)
    print("  External Merge Sort Visualizer")
    print("  http://127.0.0.1:5000")
    print("=" * 50)
    app.run(debug=True, port=5000)
