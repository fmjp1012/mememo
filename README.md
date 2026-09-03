# Mememo

資格・採用試験の問題を、デッキ別に演習する Web/iOS アプリです。

## 収録データ

- Web版の現在の収録: 日商簿記2級 228問、日商簿記3級 126問、一般幹部候補生等の最新公開問題
- 簿記問題: 2026年度にも適用される2022年度版出題区分を参照したオリジナル四肢択一問題
- 問題本文: OCR文字起こしテキストを主表示し、IPA公式PDFページ画像を確認用に保持
- 文字起こし: 各問ごとにOCR原文、整形済みMarkdown、LaTeX文字列、選択肢OCRを保持
- 正答: IPA公式の解答例PDFから抽出
- 各問メタデータ: 出典、年度、問番号、分野、公式PDF URL、ページ画像、公式解答
- 利用条件: IPA公式FAQの留意点に従い、出典を明記し、公式PDFページ画像を確認用正本として保持

OCR文字起こしは未校正です。図表、表計算、数式、選択肢ラベルの一部はOCRノイズを含むため、アプリではテキスト本文を主表示し、公式PDFページ画像を確認用に折りたたみ表示します。

## データ再生成

簿記データを旧アプリから再取り込みする場合:

```bash
node scripts/import_bookkeeping_questions.mjs \
  --source /Users/fmjp/Desktop/boki/src/questionBank.js \
  --output-root public/bookkeeping
```

生成後は `public/bookkeeping` と `ios/Mememo/Resources/bookkeeping` のJSONを同一に保ってください。

```bash
python3 scripts/build_itpass_dataset.py
```

全公式PDFセットを処理する場合:

```bash
python3 scripts/build_itpass_dataset.py --all
```

主な生成物:

- `data/itpass/processed/itpass-questions.json`: 検証用の完全JSON
- `public/itpass/questions.json`: Webアプリが起動時に読み込む問題データ
- `public/itpass/pages/...`: Web用の公式問題ページ画像
- `ios/Mememo/LearningData.swift`: iOSアプリ用データローダ
- `ios/Mememo/Resources/itpass/questions.json`: iOSアプリ用問題データ
- `ios/Mememo/Resources/itpass/pages/...`: iOS用の公式問題ページ画像

`itpass-questions.json` の各問には `transcription` が含まれます。

- `rawText`: Tesseract OCRの問別原文
- `text`: 選択肢を除いた問題文として分離できた部分
- `markdown`: アプリ表示やレビューに使う整形済み文字起こし
- `latex`: LaTeX文書へ流し込むためのエスケープ済み文字列
- `choices`: ア/イ/ウ/エに分離できた選択肢OCR

## Web

```bash
npm install
npm run dev
```

### E2E

Playwrightでデスクトップとモバイルの主要導線、OAuthプロバイダー表示、管理画面ゲート、公開／管理APIを検証します。

```bash
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:prod
```

`test:e2e`はローカルSupabase通信をモックするため、アカウントや本番データを変更しません。`test:e2e:prod`もログインや送信を行わない非破壊スモークテストです。失敗時のスクリーンショット、動画、トレース、HTMLレポートは`output/playwright/`に保存されます。GitHub Actionsではpush／PRごとにローカルE2E、手動実行と毎日のスケジュールで本番スモークテストを実行します。

### 認証・有料プラン・問い合わせ

ログイン、プロフィール、学習履歴の端末間同期、問い合わせ保存は Supabase を使います。

1. Supabase プロジェクトを作成する
2. `supabase/schema.sql` を SQL Editor で実行する
3. Authentication Providers で Email、Google、Apple を有効化する
4. Site URL と Redirect URLs に公開URLを登録する
5. `.env.example` を参考に、ローカルまたはホスティング側で以下を設定する

Email Provider ではパスワード認証とメール確認を有効にします。`user_learning_state` はRLSでログイン中の本人だけが読み書きでき、未ログイン時は従来どおりブラウザ内に学習履歴を保存します。

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

OAuth のクライアントシークレットや管理者キーはリポジトリに入れないでください。

有料プランは Stripe Checkout + Customer Portal、契約権限は Supabase、配信/API は Cloudflare Workers Static Assets を使います。無料ユーザーには各デッキ12問だけを返し、有料ユーザーには全627問を返します。`/premium/*` は署名付きHttpOnly Cookieがない限りWorkerが拒否します。

本番設定では、次の値を `npx wrangler secret put <NAME>` で登録します。

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_MONTHLY_PRICE_ID
STRIPE_YEARLY_PRICE_ID
COOKIE_SIGNING_SECRET
ADMIN_EMAILS
ADMIN_USER_IDS
FULL_ACCESS_EMAILS
FULL_ACCESS_USER_IDS
```

### 管理画面

`/admin` はCloudflare WorkerでSupabaseのアクセストークンを検証し、`ADMIN_EMAILS` または `ADMIN_USER_IDS` に一致する管理者だけが利用できます。メールによる管理者判定は、Supabaseでメール確認済みの場合に限ります。

`FULL_ACCESS_EMAILS` または `FULL_ACCESS_USER_IDS` に登録した確認済みアカウントには、Stripe契約を作らず全問題・模試・詳細記録への運営用アクセスを付与します。

管理画面では登録ユーザー数、有料会員数、学習同期数、当日利用数、問い合わせ、サイト内お知らせを確認できます。問い合わせ状態の更新とお知らせ公開は管理者API経由でのみ実行されます。サービスロールキーをブラウザへ渡さないでください。

ローカルで画面だけ確認する場合:

```bash
MEMEMO_DEV_ADMIN=1 VITE_MEMEMO_DEV_ADMIN=1 npm run dev
```

この開発用フラグはViteのモック管理データだけを有効にし、本番の管理者判定には使いません。

ローカルでCloudflare Workerまで含めて確認する場合:

```bash
npm run dev:worker
```

本番公開（外部公開の確認後に実行）:

```bash
npm run deploy:cloudflare
```

Stripe Webhook URL は `https://mememo-study.com/api/stripe/webhook` です。最低限 `checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted` を購読します。

主な実装:

- `src/learningContent.js`: 契約状態に応じた問題APIの読み込み
- `public/itpass/questions.json`: 生成済み問題データ
- `src/authClient.js`: Supabase Auth クライアント
- `src/userDataClient.js`: 学習履歴・教材進捗・設定の本人限定クラウド同期
- `src/adminClient.js`: 管理者ダッシュボードAPIとお知らせ取得
- `src/supportClient.js`: 問い合わせ・問題報告の送信
- `src/billingClient.js`: 契約状態・Checkout・契約管理API
- `worker/index.js`: 問題アクセス制御、管理者API、Stripe API/Webhook、静的配信
- `src/App.jsx`: 出題、保存、弱点復習、進捗、ログイン、問い合わせ
- `src/styles.css`: Web UI

## iOS

Xcode で `ios/Mememo.xcodeproj` を開きます。

Swiftの型チェック:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcrun swiftc -typecheck \
  -sdk /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator26.5.sdk \
  -target arm64-apple-ios17.0-simulator \
  ios/Mememo/*.swift
```

主な実装:

- `ios/Mememo/LearningData.swift`: ITパスポートJSONデータの読み込み
- `ios/Mememo/Resources/itpass/questions.json`: 生成済み問題データ
- `ios/Mememo/Models.swift`: 進捗ストア、出題ロジック、ローカル保存
- `ios/Mememo/ContentView.swift`: SwiftUI 画面
