# 量測工具（研究用）

用來把蘋果官方素材與實驗頁的玻璃放在一起量測，產出 `comparison.md` 裡的數字。蘋果素材有版權，不進倉庫，請自行下載到 `$LAB_DIR`：

- `$LAB_DIR/apple-dl/hig/img/materials-ios-liquid-glass-{over-light,over-dark,clear}@2x.png`：來自 HIG Materials（`https://developer.apple.com/tutorials/images/com.apple.HIG/…`）。
- `$LAB_DIR/liquid-glass/v3/apple-frames/219/…`：WWDC25 219 的 1080p 原幀（影片：`https://devstreaming-cdn.apple.com/videos/wwdc/2025/219/4/476dabc8-f3bb-4190-8929-4ba7131c939d/downloads/wwdc2025-219_hd.mp4`）。

先啟動 fixture 伺服器（`node node_modules/vite/bin/vite.js --config tests/fixtures/vite.config.ts`），再在倉庫根目錄執行：

```sh
export LAB_DIR=/path/to/lab
node docs/reports/2026-11-23-liquid-glass/tools/render.mjs "$LAB_DIR/liquid-glass/v3/final" current,pane,slab,v3 params.json
uv run --with pillow --with numpy --with scipy python -I docs/reports/2026-11-23-liquid-glass/tools/compare.py "$LAB_DIR/liquid-glass/v3/final" current,pane,slab,v3
```

| 檔案 | 作用 |
|---|---|
| `measure.py` | 找圓盤、CIELAB 統計、沿法線的邊緣剖面 |
| `edge_sigma.py` | 等效高斯模糊 σ（在已知模糊上驗證過） |
| `scale_blur.py` | 用頻譜同時擬合放大倍率與模糊 |
| `bevel_fit.py` | 追蹤網格線穿過透鏡的位置，擬合倒角寬度、位移與剖面 |
| `standins.py` | HIG 圓盤下方的替代底圖（四角鏡像平鋪） |
| `frame_bg.py` | 重建影片幀裡玻璃下方的背景 |
| `compare.py` | 並排圖、6 倍邊緣放大圖與數值表 |
| `render.mjs`、`render_frame.mjs` | 用實驗頁在相同幾何下渲染我們的玻璃 |
| `field.py`、`field_fit.py` | 從網格線反推透鏡的位移場：朝內或朝外、帶寬、邊緣位移、剖面，以倒角距離評分 |
| `overlay.py` | 兩邊網格線軌跡疊在同一座標系（紅：蘋果，藍：我們） |
| `diagonal.py` | 玻璃自身的光：沿對角線的 ΔL* 剖面 |
| `render_shape.mjs` | 任意圓角矩形以 3x 渲染在指定背景上（線稿上的資料夾與 Dock） |
