# WebToAPK

指定した Web ページを全画面または通常表示で開く Android WebView APK を、
ブラウザから GitHub Actions にビルド依頼できるプロジェクトです。

## 主な構成

- `web-form/`: APK ビルド依頼用のブラウザフォーム
- `android/`: Kotlin / Gradle の Android テンプレート
- `scripts/apply_config.py`: アプリ名・パッケージ名・URL・アイコンを反映
- `.github/workflows/build.yml`: APK のビルドと Artifact アップロード

## APK をビルドする

1. リポジトリの **Actions** タブを開く。
2. **Build WebView APK** ワークフローを選択する。
3. `Run workflow` からアプリ名、パッケージ名、URL、フルスクリーン設定、必要ならアイコンを指定する。
4. 完了後、実行詳細の Artifacts から APK をダウンロードする。

ブラウザフォームからもビルドを開始できます。GitHub Pages を使う場合は、リポジトリの
**Settings → Pages** で `main` ブランチの `/(root)` を公開元に設定します。公開URLのルートにある
`index.html` が `/web-form/` へ転送するため、リポジトリの Pages URL を開くだけでフォームが表示されます。
フォームはPWA対応で、HTTPSで開くとインストール可能になり、フォーム本体はオフラインでも起動できます。
Personal Access Token や GitHub API の応答は Service Worker のキャッシュ対象外です。Personal Access Token は
ブラウザに保存しないことを推奨します。

## 必要な設定

ビルドは GitHub Actions 上で実行するため、ローカルへの Android Studio、
Android SDK、JDK のインストールは不要です。ワークフローを実行する前に、
リポジトリの **Settings → Actions → General** で Actions の実行が許可されて
いることを確認してください。

## 権限

GitHub Personal Access Token は Fine-grained PAT を使用し、対象リポジトリの
**Actions: read and write** 権限を付与してください。トークンを保存する設定を
有効にするとブラウザの localStorage に保存されます。共有端末では有効にしないで
ください。
