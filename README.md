# Quest 3 WebXR Vision Trainer / 目のストレッチ

Meta Quest 3向けのWebXR目のストレッチ＆水中リラクゼーションアプリです。  
**MR（カラーパススルー）**、**VR（没入空間）**、および **PCブラウザ上の3Dプレビュー** に対応し、コントローラー・ハンドトラッキング（ピンチ）・視線（Gaze）操作のすべてで動作します。

## デモ

- https://xr.croud.jp

## 機能・ストレッチモード

1. **遠近ピントストレッチ** (`FocusStretchMode`)
   - `0.38m〜12.0m` の遠近往復・3D 8の字軌道・螺旋追従の3パターンで毛様体筋をほぐします。
   - 呼吸ガイドリングと距離表示で、追従しながらピントを緩めます（正誤判定なし）。
2. **眼球運動ストレッチ** (`PeripheralMode`)
   - 左右・上下・8の字・円の誘導ターゲットをゆっくり追い、眼球まわりの筋肉をやさしく動かします。
3. **回旋・スムーズパーシュート** (`GaborPatchMode`)
   - 頭部正面の大きな円軌道を時計回り／反時計回りで追い、滑らかな眼球運動を促します。難易度で半径と周期が変わります。
4. **輻輳・開散ストレッチ** (`BinocularMode`)
   - 左右ターゲットが寄り→離れをゆっくり繰り返し、輻輳と開散をガイドします（成功／失敗なし）。
5. **水中リラクゼーション** (`AquaticRelaxMode`)
   - プロシージャル生成された水棲生物・水草と気泡に囲まれ、深呼吸と遠方注視で目の緊張を和らげます。

難易度は点数ではなく、動作の速さ・振幅・所要時間のみに影響します（Easy=ゆったり長め / Hard=やや速く短め）。

## 操作方法

- **VRコントローラー**: レーザーポインターを合わせてトリガーで決定（左スティックで水平移動、右スティックで高さ調整・旋回）
- **ハンドトラッキング**: レーザー／ポインターを合わせてピンチ操作で決定（空間内の `ポインタ ▲ / ▼ / ◀ / ▶` ボタンで視線ポインタ位置を微調整可能）
- **視線（Gaze）操作**: レティクル（中央カーソル）をボタンやターゲットに一定時間合わせ続けると自動決定（メニューからON/OFF切替可能、`localStorage`に調整位置を保存）
- **PCブラウザ（Desktop 3D Preview）**: 左クリックで選択、ドラッグで視点回転、矢印キーで視線ポインタ位置の微調整（`0`で中央リセット）、`WASD`/`Q`/`E`/ホイールでカメラ移動、`R` キーで視点リセット

## 技術スタック

- **TypeScript + Vite + Three.js**
- **`@vitejs/plugin-basic-ssl`**（Quest 3実機LAN接続用のローカルHTTPSサーバー）
- **Web Audio API**（3D定位ピン音・呼吸ガイド・癒やし音生成）
- **`localStorage`**（モード別の実施回数・累計時間の保存）

## セットアップ・起動

```powershell
# 依存パッケージのインストール
npm install

# HTTPS開発サーバーの起動（PC・Quest 3両対応）
npm run dev
```

### Meta Quest 3 実機からの接続
1. PCとMeta Quest 3を同じWi-Fiネットワークに接続します。
2. `npm run dev` 実行時に表示される Network URL（例: `https://192.168.x.x:5173/`）をQuestブラウザで開きます。
3. 自己署名証明書の警告が表示された場合は「詳細設定」→「進む」で許可し、**「Enter MR (Passthrough)」** または **「Enter VR (Space)」** を選択してください。

## ビルド・Cloudflare Workersへのデプロイ

```powershell
# TypeScript型チェック + プロダクションビルド
npm run build

# Cloudflare Workersへビルド＆デプロイ（cf CLI使用）
npm run deploy
# または手動で順番に実行
npm run build && cf deploy dist
```

デプロイ設定は [cloudflare.config.ts](./cloudflare.config.ts) に定義されています。

## ライセンス

All Rights Reserved（`UNLICENSED` / 再利用・再配布禁止）。
