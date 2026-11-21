WebView APK Builder 詳細仕様書1. プロジェクト概要指定したURLを全画面（または通常表示）のWebViewで開くだけのシンプルなAndroidアプリ（APK）を、ブラウザ上の入力フォームからパラメータを送信し、GitHub Actions上で自動ビルド・生成するシステム。目的Android Studioを毎回起動することなく、Webサイトをアプリ化（ラッパーAPK化）できるようにする。実行毎に変化する5つのパラメータ（アプリ名、パッケージ名、アプリアイコン、接続先URL、フルスクリーン起動の有無）をUX良く指定し、GitHub Actions経由でAPKを取得する。2. システム全体アーキテクチャ[ブラウザ (Webフォーム: web-form/index.html)]
│ 1. フォーム入力（画像リサイズ・Base64化・バリデーション）
│ 2. GitHub REST API (workflow*dispatch) を実行
▼
[GitHub Actions (.github/workflows/build.yml)]
│ 3. inputs を受け取り、Androidテンプレートのファイルを動的書き換え
│ 4. アプリアイコン(PNG)を各解像度またはアダプティブアイコンへ配置
│ 5. Gradle で APK をビルド (./gradlew assembleDebug)
│ 6. 生成された APK を Artifact としてアップロード
▼
[成果物 (app-debug.apk / リネーム済みAPK)]3. ディレクトリ構成.
├── .github/
│ └── workflows/
│ └── build.yml # APKビルド用 GitHub Actions ワークフロー
├── android/ # Android プロジェクトテンプレート一式
│ ├── app/
│ │ ├── build.gradle.kts # モジュールレベル Gradle 設定
│ │ └── src/
│ │ └── main/
│ │ ├── AndroidManifest.xml
│ │ ├── java/com/template/webviewapp/
│ │ │ └── MainActivity.kt
│ │ └── res/
│ │ ├── mipmap-anydpi-v26/
│ │ │ ├── ic_launcher.xml
│ │ │ └── ic_launcher_round.xml
│ │ ├── mipmap-xxxhdpi/
│ │ │ └── ic_launcher_foreground.png # 差し替え対象アイコン
│ │ └── values/
│ │ ├── colors.xml
│ │ ├── strings.xml # アプリ名差し替え対象
│ │ └── themes.xml
│ ├── gradle/
│ │ └── wrapper/
│ │ ├── gradle-wrapper.jar
│ │ └── gradle-wrapper.properties
│ ├── build.gradle.kts # プロジェクトレベル Gradle 設定
│ ├── gradlew
│ └── settings.gradle.kts
├── scripts/
│ └── apply_config.py # GitHub Actions 内で設定値・画像を反映するスクリプト
├── web-form/ # ブラウザ用入力フォーム（GitHub Pages またはローカル実行）
│ ├── index.html
│ ├── style.css
│ └── app.js
├── .gitignore
├── LICENSE
└── README.md4. 入力パラメータ仕様（実行毎の可変項目）GitHub Actions の workflow_dispatch.inputs で受け取るデータ仕様は以下の通り。キー名 (inputs.<key>)型必須デフォルト値説明・制約app_namestringYes"WebApp"ホーム画面等に表示されるアプリ名。XMLエスケープ対象。package_namestringYes"com.example.webviewapp"Androidの applicationId。正規表現 ^[a-z]a-z0-9*]_(\.[a-z][a-z0-9_]_)+$ に準拠すること。target*urlstringYes"https://example.com"起動時に読み込むURL。http:// または https:// で始まること。fullscreenbooleanYestruetrue の場合、ステータスバー・ナビゲーションバーを非表示（没入モード）で起動する。icon_base64stringNo""アプリアイコンのPNGデータをBase64エンコードした文字列（data:image/png;base64, プレフィックスなし）。未指定時はデフォルトアイコンを使用。※ GitHub Actions inputs のペイロード制限に関する注意
workflow_dispatch のAPIリクエストボディ（inputs 全体）には約65KBの上限があるため、Webフォーム側で画像を 192×192px または 256×256px 程度のPNG（圧縮済み） にリサイズし、Base64文字列長が 45,000文字以内 に収まるよう制御する。5. Webフォーム仕様 (web-form/)5.1 技術スタックバニラ HTML5 / CSS3 / JavaScript（フレームワーク不使用、単体ブラウザまたは GitHub Pages で動作）5.2 画面項目・UI/UX要件GitHub 接続設定セクション（折りたたみ・ローカル保存対応）Owner（GitHubユーザー名）Repo（リポジトリ名）Branch（デフォルト: main）Personal Access Token (Fine-grained PAT)（password フィールド）チェックボックス：「ブラウザ（localStorage）に認証情報を保存する」アプリ設定セクション（5項目）アプリ名：テキスト入力（必須）。入力と同時にパッケージ名候補のサジェスト補助が可能。パッケージ名：テキスト入力（必須）。リアルタイムバリデーション（小文字英数字とドット区切り、最低2階層以上）を表示。過去の入力履歴を <datalist> で補完。アプリアイコン：ドラッグ＆ドロップおよびファイル選択（image/\*）対応。選択後、HTML5 <canvas> を用いて正方形（中央クロップ）に整形し、256×256px の PNG へ変換。変換後の丸型・角丸スクエアのプレビュー表示と、Base64データサイズ（KB表示・上限チェック）を表示。接続先URL：URL入力（必須）。https:// プレフィックスの自動補完および形式チェック。フルスクリーン起動の有無：トグルスイッチ（デフォルト ON = true）。送信・ステータス表示セクション「APKビルドを開始する」ボタン（送信中は多重クリック防止のため disabled 化）。GitHub API レスポンス表示エリア（成功時は該当リポジトリの Actions 実行一覧ページへの直リンク を表示）。5.3 API呼び出し仕様Endpoint: POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/build.yml/dispatchesHeaders:Accept: application/vnd.github+jsonAuthorization: Bearer {PAT}X-GitHub-Api-Version: 2022-11-28Body:
{
"ref": "main",
"inputs": {
"app_name": "サンプルアプリ",
"package_name": "com.suwanohiro.sample",
"target_url": "https://example.com",
"fullscreen": true,
"icon_base64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
}6. Androidアプリ仕様 (android/)6.1 ビルド環境・SDK要件Language: KotlinCompile SDK / Target SDK: 34 (Android 14) または 35 (Android 15)Min SDK: 24 (Android 7.0)Java Version: JDK 176.2 機能要件 (MainActivity.kt)WebView 設定JavaScript 有効化（javaScriptEnabled = true）DOM Storage 有効化（domStorageEnabled = true）ズーム操作の最適化（ピンチズーム可・画面幅フィット useWideViewPort = true, loadWithOverviewMode = true）ファイル選択（<input type="file">）や外部リンク（tel:, mailto:, 外部スキーム）の適切なハンドリングWebViewClient を設定し、同一ドメイン・HTTP(S)遷移が外部ブラウザへ飛ばずアプリ内で完結するように制御バックキー（戻る操作）制御OnBackPressedDispatcher を使用し、webView.canGoBack() が true の場合はブラウザバックを実行、履歴がない場合はアプリを終了する。フルスクリーン制御 (BuildConfig.IS_FULLSCREEN)true の場合：WindowCompat.setDecorFitsSystemWindows(window, false) および WindowInsetsControllerCompat を使用し、ステータスバー・ナビゲーションバーを非表示（スワイプで一時表示 BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE）にする。false の場合：通常のシステムバー表示を維持する。権限 (AndroidManifest.xml)<uses-permission android:name="android.permission.INTERNET" /><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />android:usesCleartextTraffic="true"（ローカルIPや http:// 接続を許容するため）6.3 動的パラメータの受け渡し方式android/app/build.gradle.kts 内の defaultConfig に以下を定義し、scripts/apply_config.py から値を書き換える（または res/values/config.xml を生成して参照する）。applicationId ← package_nameresValue("string", "app_name", ...) ← app_namebuildConfigField("String", "TARGET_URL", ...) ← target_urlbuildConfigField("boolean", "IS_FULLSCREEN", ...) ← fullscreen7. GitHub Actions ワークフロー仕様 (.github/workflows/build.yml)7.1 トリガー条件on:
workflow_dispatch:
inputs:
app_name:
description: 'アプリ名'
required: true
default: 'WebApp'
type: string
package_name:
description: 'パッケージ名 (例: com.example.app)'
required: true
default: 'com.example.webviewapp'
type: string
target_url:
description: '接続先URL'
required: true
default: 'https://example.com'
type: string
fullscreen:
description: 'フルスクリーン起動の有無'
required: true
default: true
type: boolean
icon_base64:
description: 'アプリアイコン (Base64 PNG)'
required: false
default: ''
type: string7.2 ジョブ実行ステップ (ubuntu-latest)Checkout: actions/checkout@v4 でリポジトリを取得。Setup JDK 17: actions/setup-java@v4（distribution: 'temurin', java-version: '17'）をセットアップ。Setup Gradle: gradle/actions/setup-gradle@v4 でビルドキャッシュを有効化。Apply App Configuration:Pythonスクリプト（scripts/apply_config.py）を実行し、環境変数経由で受け取った各パラメータを検証・適用。strings.xml の app_name 更新（XML特殊文字エスケープ実施）。app/build.gradle.kts の applicationId、TARGET_URL、IS_FULLSCREEN 更新。icon_base64 が指定されている場合、Base64デコードして ic_launcher_foreground.png 等へ保存（未指定時はデフォルトアイコンを維持）。Grant Execute Permission: chmod +x android/gradlewBuild Debug APK:cd android && ./gradlew assembleDebug を実行。Rename & Upload Artifact:生成された app-debug.apk を {app_name}*{package_name}.apk（ファイル名に使える文字へサニタイズ）にリネーム。actions/upload-artifact@v4 でアップロード（保持期間: 7日など任意設定）。8. 開発・実装ステップ計画Phase 1: Android ベースプロジェクトの作成 (android/)最小構成の Gradle ファイル、AndroidManifest.xml、MainActivity.kt、デフォルトリソース一式を配置し、ローカルまたは手動Actionsで assembleDebug が通ることを確認する。Phase 2: 設定反映スクリプトと GitHub Actions の構築 (scripts/, .github/workflows/build.yml)apply_config.py を実装し、GitHub の Actions タブ上の手動実行（workflow_dispatch）からパラメータを変えてAPKが生成されることを確認する。Phase 3: Web 入力フォームの実装 (web-form/)画像リサイズ＆Base64変換機能、バリデーション、GitHub API 連携を含むフォーム画面を作成し、GitHub Pages またはローカルブラウザから一連のビルドをテストする。
