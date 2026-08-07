# StockVIP — 正式版（React + Supabase）

這是從原本 HTML 原型遷移出來、**真正可以部署上線**的專案。用 Vite + React 做前端，Supabase 負責資料庫、會員驗證（Auth，內建 bcrypt 雜湊密碼＋JWT）、圖片儲存（Storage）。

## 這個版本包含什麼

- ✅ 會員註冊／登入（Supabase Auth，密碼 bcrypt 雜湊、JWT session，內建寄送驗證信）
- ✅ 首頁商品列表（課程／訂閱／共享帳號三分類）
- ✅ 商品詳情頁 + 餘額購買（用 Postgres function 做原子扣款，避免併發扣款出錯）+ USDT/Telegram 導轉
- ✅ 會員中心（我的訂閱／已購課程／共享帳號）+ 錢包頁
- ✅ 管理後台：商品 CRUD（含拖曳排序、本機圖片上傳到 Supabase Storage）、文章發布（簡化版單一文字段落）、會員權限管理
- ✅ 滿屏低密度浮水印（沿用之前原型調校過的顏色/透明度）
- ✅ Row Level Security：資料庫層面就擋掉未授權存取，不是只靠前端隱藏
- ✅ 隱藏後台入口：導覽列沒有管理後台按鈕，直接打 `/admin` 進入（見下方說明）

## 這個版本先簡化／還沒做的部分（老實列出來，避免你誤會已經 100% 完工）

- 文章編輯器簡化成「單一文字段落」，原型裡「文字接圖片再接文字」的區塊拖曳排序編輯器還沒搬過來（架構上 `articles.blocks` 欄位已經是 `jsonb` 陣列，之後要擴充是加前端 UI，不用動資料庫） Done


- 多語言（繁/簡/EN）先拿掉，只有繁中，之後要加回來建議用 `react-i18next`
- USDT／余额支付都還是「人工核實」流程，還沒接自動鏈上到帳偵測
- 到期提醒信、文章發布通知信還沒接（需要另外設定 Resend/SendGrid，見下方步驟）
- 內容防右鍵/防選取/防拖曳複製的 CSS 保護還沒搬過來（如需要可以再加）

---

## 一、本機開發設定

### 1. 安裝依賴

```bash
npm install
```

### 2. 建立 Supabase 專案

1. 到 [supabase.com](https://supabase.com) 建立新專案。
2. 到 **SQL Editor**，貼上 `supabase/schema.sql` 整份內容並執行。這會建立所有資料表、RLS 規則、以及購買用的 Postgres function。
3. 到 **Storage**，建立一個 bucket 叫做 `product-images`，設為 **Public**。
4. 到 **Project Settings → API**，複製 `Project URL` 和 `anon public` key。

### 3. 設定環境變數

```bash
cp .env.example .env
```

打開 `.env`，填入：
- `VITE_SUPABASE_URL`／`VITE_SUPABASE_ANON_KEY`：上一步複製的值
- `VITE_USDT_BEP20_ADDRESS`：你的真實 USDT-BEP20 收款地址
- `VITE_TELEGRAM_SUPPORT_URL`：你的真實 Telegram 客服連結

### 4. 啟動開發伺服器

```bash
npm run dev
```

打開 `http://localhost:5173` 應該就能看到網站。

### 5. 建立第一個管理員帳號

1. 先用網站的「註冊」流程，正常註冊一個帳號（會收到驗證信，記得點信裡連結完成驗證）。
2. 回到 Supabase Dashboard → SQL Editor，執行：
   ```sql
   update public.profiles set role = 'admin' where email = '你剛剛註冊的email';
   ```
3. 之後用這個帳號登入，打開 `你的網址/admin` 就能進到後台。

---

## 二、部署上線

### 1. 前端部署（建議 Vercel，最簡單）

1. 把這個專案推上 GitHub。
2. 到 [vercel.com](https://vercel.com) 用 GitHub 帳號登入，選擇這個 repo 匯入。
3. Vercel 會自動偵測是 Vite 專案。部署前記得在 **Environment Variables** 設定跟 `.env` 一樣的四個變數（`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_USDT_BEP20_ADDRESS`、`VITE_TELEGRAM_SUPPORT_URL`）。
4. 部署完成後 Vercel 會給一個 `xxx.vercel.app` 網址。

### 2. 接上你自己的網域＋SSL

1. 在 Vercel 專案的 **Settings → Domains**，輸入你買的網域（例如 `stockvip.com`）。
2. Vercel 會顯示需要在你的網域註冊商（GoDaddy、Cloudflare、Namecheap…）加哪幾筆 DNS 紀錄（通常是一筆 `A` 記錄指到 Vercel 的 IP，或一筆 `CNAME`）。
3. 加好 DNS 之後，Vercel 會自動幫你簽發 SSL 憑證（Let's Encrypt），不用自己另外處理。
4. 等 DNS 生效（通常幾分鐘到幾小時），`https://stockvip.com` 就能直接打開你的網站。

### 3. Supabase Auth 的網域設定

到 Supabase Dashboard → **Authentication → URL Configuration**：
- **Site URL** 填你的正式網域，例如 `https://stockvip.com`
- **Redirect URLs** 加上 `https://stockvip.com/*`

這樣註冊驗證信裡的連結才會導回你的正式網站，而不是 localhost。

### 4. 接真實寄信服務（到期提醒 / 文章發布通知）

會員註冊驗證信、忘記密碼信，Supabase Auth 已經內建幫你處理好了（Authentication → Email Templates 可以改成中文內容）。

但「到期提醒」「文章發布通知訂閱會員」這種客製化信件，需要額外接：

1. 註冊 [Resend](https://resend.com)，拿到 API Key，並驗證你的網域（這樣寄出的信才不會被當垃圾郵件）。
2. 在 Supabase Dashboard → **Edge Functions**，建立一個新函式（可以用 Supabase CLI：`supabase functions new send-notification`）。
3. 把 API Key 設成 Edge Function 的環境變數（Secrets）：
   ```bash
   supabase secrets set RESEND_API_KEY=your_key_here
   ```
4. 部署函式：
   ```bash
   supabase functions deploy send-notification
   ```
5. 之後在後台加一個「發送提醒」按鈕，讓它呼叫這個 Edge Function 即可（這部分程式碼目前還沒寫，因為要先確定你 Resend 帳號設定好、網域驗證通過後我再幫你把串接邏輯補上）。

---

## 三、下一步可以做的強化

依優先順序，建議之後這樣加強：

1. **把管理員登入跟一般會員分開**：現在管理員也是走 Supabase Auth 一般登入，只是多一個 `role='admin'` 判斷。如果流量大，建議另外做一個獨立的管理員登入頁＋更嚴格的 rate limit。
2. **文章區塊編輯器**：把原型裡「文字接圖片」的區塊拖曳排序編輯器搬過來（`articles.blocks` 資料結構已經相容，只需要補前端 UI）。
3. **自動鏈上到帳偵測**：接 BscScan API 或 Moralis，輪詢收款地址，自動核對金額後呼叫 `purchase_with_balance` 類似邏輯自動開通（目前是人工核實）。
4. **多語言**：加回繁/簡/EN 三語系，建議用 `react-i18next`。
5. **零寬字元文字浮水印溯源工具**：如果你們的內容主要是純文字文章、擔心被複製貼上外流，這個工具值得補回來（圖片視覺浮水印已經涵蓋了截圖外流的情況）。

有任何一項你想先做，跟我說，我可以直接接著往下寫。
