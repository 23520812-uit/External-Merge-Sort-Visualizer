# External Merge Sort Visualizer

Web app trực quan hóa thuật toán **External Merge Sort** (Flask + HTML/CSS/JS), hỗ trợ chạy từng bước để quan sát đầy đủ quá trình tạo run và merge pass.

## Chế độ thuật toán

- `Standard`: Chia input thành các chunk kích thước `B`, sort trong RAM rồi ghi ra sorted runs.
- `Repacking` (Replacement Selection): Dùng min-heap để tạo runs dài hơn ở Pass 0.

## Tính năng chính

- Nhập dữ liệu thủ công hoặc dùng preset (`Random`, `Best-cased`, `Sorted`, `Duplicates`, `Near-sorted`).
- Điều chỉnh `B (Buffer Pages)` và bật/tắt `Repacking`.
- Điều khiển animation: `<<`, `Play/Pause`, `>>`, `Reset`, thanh tốc độ.
- Step backward tối ưu bằng checkpoint state (nhẹ hơn snapshot HTML full).
- Dark/Light mode.
- Nhật ký thao tác với vùng xem cố định (không làm layout nhảy khi log tăng).

> Lưu ý: cấu hình hiện tại yêu cầu `B >= 3` để merge hoạt động đúng.

## Yêu cầu môi trường

- Python 3.11

## Cài đặt

### Conda (khuyến nghị)

```bash
conda env create -f environment.yml
conda activate cs523
```

### Pip

```bash
pip install -r requirements.txt
```

## Chạy ứng dụng

```bash
python app.py
```

Mở trình duyệt tại: `http://127.0.0.1:5000`

## Luân phiên 2 môi trường chạy

Frontend hiện tự chọn backend theo môi trường:

- Chạy local (`localhost` / `127.0.0.1`) -> gọi API local Flask: `http://127.0.0.1:5000`
- Chạy trên GitHub Pages (hoặc domain khác) -> gọi API Render: `https://external-merge-sort-visualizer.onrender.com`

## Khuyến nghị hiệu năng

Nên **clone repo về máy và chạy local** để có trải nghiệm mượt và phản hồi nhanh hơn.

Lý do: backend trên Render (gói miễn phí) có thể bị cold start, nên request đầu tiên thường chậm.

## Cấu trúc thư mục

```text
.
├── index.html
├── script.js
├── style.css
├── app.py
├── environment.yml
├── requirements.txt
```
