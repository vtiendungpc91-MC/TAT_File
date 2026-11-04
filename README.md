# Sổ Thu Chi — app quản lý thu chi cá nhân (chạy offline)

Web app (PWA): cài lên màn hình chính iPhone/Android như app thật, chạy **không cần mạng**.
Dữ liệu chỉ lưu trên điện thoại (IndexedDB), không gửi lên server nào.

## Tính năng

| Nhóm | Có gì |
|---|---|
| **Thu chi (B)** | Nhập nhanh (gõ `50k`, `1tr2`, `2,5tr`), giao dịch định kỳ (tự ghi hoặc chờ xác nhận), ảnh hóa đơn, nhập bằng giọng nói, tag + chia nhiều danh mục, đa tiền tệ (tỷ giá tự nhập), phím tắt khi nhấn giữ icon app (Android) |
| **Ngân sách (D)** | Hạn mức theo tuần/tháng/năm, cảnh báo 80% và 100%, phân bổ 50/30/20 hoặc 6 chiếc lọ (JARS), mục tiêu tiết kiệm, quỹ dự phòng tự tính theo chi tiêu trung bình |
| **Nhắc nhở (F)** | Nhắc trước hạn N ngày ngay trong app, thông báo hệ thống khi mở app, xuất hạn trả nợ và nhắc ghi chép hằng ngày sang **app Lịch** của điện thoại, tóm tắt tuần/tháng để chia sẻ |
| **Trả nợ (A)** | Ngân hàng, số tiền mỗi kỳ, ngày đến hạn, lặp hằng tháng và số kỳ còn lại, cách thanh toán và ghi chú (STK, nội dung CK…), đánh dấu đã trả (tự ghi khoản chi), hoàn tác |
| **Tài khoản ngân hàng** | Tiền nằm trong tài khoản ngân hàng (không có Tiền mặt): ngân hàng, số TK, chủ TK, tên gợi nhớ; thêm nhiều tài khoản; chỉnh số dư cho khớp app ngân hàng. **Không đủ số dư thì không chi, chuyển khoản, góp, trả nợ hay nạp mục tiêu được**; khoản định kỳ tự động thiếu tiền sẽ chờ xử lý |
| **Khóa app** | Mật khẩu số khi mở app (mặc định `2024`, nên đổi trong Cài đặt → Bảo mật), tự khóa khi rời app, che nội dung ở màn hình đa nhiệm, sai 5 lần phải chờ 30 giây |
| **Người dùng & mục** | Tối đa 3 người dùng (nút góc trái trên; trong đó có ⚙️ Cài đặt). Mỗi người dùng tạo các mục 🏦 Ngân hàng, 📈 Đầu tư (sổ thu/chi có tài khoản) và 💳 Thẻ chi tiêu — chọn/tạo ở nút góc phải trên |
| **Nhiều người dùng** | Mỗi người (bạn, vợ/chồng, con…) có sổ riêng: ví, giao dịch, ngân sách, mục tiêu, trả nợ, cài đặt tách biệt. Chuyển người bằng nút tên ở góc trên trái |
| **Góp** | Chuyển tiền từ người này sang người khác: sổ người góp ghi khoản chi "Góp cho …", sổ người nhận ghi khoản thu "Nhận góp từ …". Xóa một bên thì bên kia tự xóa theo |
| **Trích** | Ngược với Góp: lấy tiền từ tài khoản của người khác về tài khoản của mình (người bị trích phải đủ số dư) |
| **Thẻ chi tiêu** | Tạo trong danh sách người dùng (+ Thẻ chi tiêu). Thẻ không có số dư: ghi các khoản chi theo nguồn (MoMo, ZaloPay, ShopeePay…), sau đó **Trích thanh toán** từng khoản (hoặc tất cả) từ tài khoản của một người dùng → khoản chuyển **Done**, sổ người trả ghi khoản chi tương ứng. Hủy thanh toán / xóa bên người trả thì khoản của thẻ mở lại |
| **Nhập số tiền** | Tự thêm dấu chấm phân cách hàng nghìn khi gõ; gợi ý nút **+000** để nhập nhanh |
| **Avatar** | Hơn 40 icon ngộ nghĩnh (người, thú cưng, emoji) hoặc dùng ảnh riêng làm avatar cho người dùng/thẻ |
| **Ẩn/hiện mục** | Mỗi người dùng tự chọn ẩn/hiện mục Báo cáo, Kế hoạch (Cài đặt → Hiển thị) |
| **Báo cáo** | Tổng quan/Giao dịch xem theo ngày/tháng; Báo cáo chọn ngày, tháng, quý, năm hoặc khoảng thời gian tự chọn, biểu đồ thu chi theo thời gian, biểu đồ tròn theo danh mục, so sánh với kỳ trước, chi theo tag |
| **Dữ liệu** | Sao lưu **tất cả** người dùng + thẻ chi tiêu vào 1 file `.json` và khôi phục toàn bộ từ file đó (vẫn đọc được bản sao lưu cũ chỉ có 1 sổ); xuất CSV mở bằng Excel |

## 1. Chạy thử trên máy tính

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Mở `http://localhost:8080` bằng Chrome hoặc Edge. Bấm F12, chọn biểu tượng điện thoại để xem giao diện mobile.

## 2. Đưa lên GitHub Pages (miễn phí, chỉ làm 1 lần)

Không cần cài Git, làm hoàn toàn trên trình duyệt:

1. Tạo tài khoản tại https://github.com (nếu chưa có).
2. Bấm **New repository**, đặt tên ví dụ `sothuchi`, chọn **Public**, rồi bấm **Create repository**.
3. Trong repo mới, bấm **uploading an existing file** và kéo thả **toàn bộ nội dung** thư mục này vào: `index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll` và các thư mục `css`, `js`, `icons`. Không cần `serve.ps1` và `README.md`. Sau đó bấm **Commit changes**.
   > File `.nojekyll` bị Windows ẩn đi. Nếu không thấy thì bỏ qua cũng được.
4. Vào **Settings → Pages**. Ở mục *Build and deployment*, chọn **Deploy from a branch**, branch `main`, thư mục `/ (root)`, rồi bấm **Save**.
5. Đợi 1–2 phút, link app sẽ có dạng `https://<tên-tài-khoản>.github.io/sothuchi/`.

> Repo Public thì ai có link cũng xem được **mã nguồn app**, nhưng **không xem được dữ liệu** của bạn, vì dữ liệu chỉ nằm trên điện thoại.

## 3. Cài lên điện thoại

**iPhone (iOS 16.4+ khuyến nghị)**
1. Mở link bằng **Safari** (bắt buộc dùng Safari).
2. Bấm nút **Chia sẻ** ⬆️, chọn **Thêm vào MH chính**, rồi bấm **Thêm**.
3. Mở app từ icon "Thu Chi" trên màn hình chính. Từ đây app chạy offline.

**Android**
1. Mở link bằng **Chrome**.
2. Bấm menu ⋮, chọn **Cài đặt ứng dụng** (hoặc **Thêm vào màn hình chính**).
3. Nhấn giữ icon app để thấy phím tắt *Thêm khoản chi / Thêm khoản thu / Lịch trả nợ*.

## 4. Cập nhật app sau khi sửa code

1. Mở `sw.js`, tăng số phiên bản: `const VERSION = 'v1.0.1';`
2. Upload lại các file đã sửa lên GitHub.
3. Trên điện thoại, mở app khi có mạng, đóng hẳn rồi mở lại. Dữ liệu vẫn giữ nguyên.

## 5. Lưu ý quan trọng

- **Sao lưu định kỳ** (Cài đặt → Sao lưu) vào iCloud Drive, Google Drive hoặc Zalo "Cloud của tôi". Xóa app khỏi màn hình chính hoặc xóa dữ liệu Safari/Chrome sẽ **mất dữ liệu**.
- **Nhắc hạn khi app đang đóng:** web app không tự báo chuông được. Hãy bấm **"Thêm vào Lịch"** ở khoản nợ hoặc ở Cài đặt → Nhắc ghi chép. App Lịch của điện thoại sẽ báo cả khi offline. Thông báo trong app chỉ hiện khi bạn mở app.
- **Giọng nói** dùng nhận dạng của trình duyệt và thường **cần mạng**. Trên iPhone, tính năng này có thể không hoạt động khi mở từ màn hình chính; khi đó nút 🎤 sẽ tự ẩn.
- **Thêm vào Lịch trên iPhone:** nếu nút "Mở bằng app Lịch" không phản hồi, dùng "Chia sẻ / Lưu file .ics", lưu vào Tệp rồi mở file đó.
- **Tỷ giá ngoại tệ** do bạn tự nhập (app offline nên không tự cập nhật).

## Cấu trúc mã nguồn

```
index.html            khung trang + thanh tab
manifest.webmanifest  thông tin cài đặt PWA (tên, icon, phím tắt)
sw.js                 service worker – cache để chạy offline
css/app.css           giao diện (tự đổi sáng/tối theo máy)
js/app.js             khởi động, điều hướng, thông báo
js/views.js           các màn hình và form
js/store.js           nghiệp vụ: số dư, tổng hợp, định kỳ, trả nợ, ngân sách, sao lưu
js/db.js              lưu trữ IndexedDB
js/utils.js           định dạng tiền/ngày, đọc số tiền gõ tắt, kỳ tuần/tháng/năm
js/charts.js          biểu đồ SVG
js/voice.js           nhập bằng giọng nói
js/ics.js             tạo file lịch .ics
icons/                icon app
serve.ps1             server chạy thử trên máy tính
```
