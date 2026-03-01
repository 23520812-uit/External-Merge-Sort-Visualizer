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

## Cấu trúc thư mục

```text
.
├── index.html
├── script.js
├── style.css
├── app.py
├── environment.yml
├── requirements.txt
├── templates/
│   └── index.html
└── static/
    ├── script.js
    └── style.css
```
