# Binance BBW 掃描器（免費 GitHub Pages 版）

這是一個可加到 iPhone 主畫面的 PWA。掃描由 GitHub Actions 每 4 小時執行一次，網頁由 GitHub Pages 提供。使用 Binance 公開 USD-M USDT 永續合約行情 API，不需要 API Key、不連接交易帳戶，也不會下單。

## 掃描規則

- 市場：Binance USD-M USDT 永續合約。
- 布林帶：20 根 K 線、2 倍標準差、收盤價。
- 突破榜：1–20 小時週期；BBW ≥ 50%；掃描時最新價格高於上軌；已收盤日線 EMA200 高於 MA200 且差距 ≥ 2%；依偏離上軌幅度由高至低排序。
- 收縮榜：1–5 小時及 16–20 小時週期；BBW ≤ 2%；依 BBW 由低至高排序。
- 週期 K 線由已收盤 1 小時 K 線聚合；日線 EMA200/MA200 只使用已收盤日線；現價使用掃描時的最新價格。
- 保存最近 30 次掃描快照。每次掃描時間為 UTC 00/04/08/12/16/20，換算 UTC+8 為 08/12/16/20/00/04。

## 一次性設定（手機瀏覽器即可）

1. 在 GitHub 建立一個 **Public** repository，名稱例如 `binance-bbw-scanner`。
2. 將這個資料夾裡的所有檔案和資料夾上傳到 repository 根目錄。注意：`.github/workflows/deploy.yml` 是隱藏路徑，必須一起上傳；`scripts/scan.mjs` 也必須保留。
3. 開啟 repository 的 **Settings → Pages**，在 **Build and deployment → Source** 選 **GitHub Actions**。
4. 開啟 **Actions** 分頁。如果 GitHub 顯示需要允許 workflow，按下允許。
5. 在左側選 **Scan Binance BBW and publish PWA**，按 **Run workflow → Run workflow**。首次全市場掃描可能需要數分鐘，請等待綠色勾號。
6. 完成後，在 **Settings → Pages** 可以看到網站網址，通常是 `https://你的帳號.github.io/binance-bbw-scanner/`。
7. iPhone 用 Safari 打開該網址 → 分享 → **加入主畫面**。

## 免費額度與限制

- 公開 repository 的 GitHub Pages / Actions 可在免費方案額度內使用；平台政策或額度日後可能變動，不能保證永久零成本。
- Binance API 有請求速率限制。若全市場掃描偶爾失敗，請到 Actions 查看錯誤訊息，或稍後重新執行。程式會有限度重試。
- 排程可能因 GitHub 負載而延遲；這不是即時推播。打開 App 後點「更新資料」只會重新讀取最近一次已發布的掃描結果，不會手動啟動全市場掃描。
- 不要在 GitHub 放任何交易 API Key。本專案不需要任何密鑰。
