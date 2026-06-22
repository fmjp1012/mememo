# Mememo

ITパスポート試験の公式公開問題を、出典付きで演習する Web/iOS アプリです。

## 収録データ

- 現在のアプリ収録: IPA公式公開PDF 29セット、ITパスポート試験 公開問題 2,900問
- 問題本文: OCR文字起こしテキストを主表示し、IPA公式PDFページ画像を確認用に保持
- 文字起こし: 各問ごとにOCR原文、整形済みMarkdown、LaTeX文字列、選択肢OCRを保持
- 正答: IPA公式の解答例PDFから抽出
- 各問メタデータ: 出典、年度、問番号、分野、公式PDF URL、ページ画像、公式解答
- 利用条件: IPA公式FAQの留意点に従い、出典を明記し、公式PDFページ画像を確認用正本として保持

OCR文字起こしは未校正です。図表、表計算、数式、選択肢ラベルの一部はOCRノイズを含むため、アプリではテキスト本文を主表示し、公式PDFページ画像を確認用に折りたたみ表示します。

## データ再生成

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

主な実装:

- `src/learningContent.js`: ITパスポートJSONデータの読み込み
- `public/itpass/questions.json`: 生成済み問題データ
- `src/App.jsx`: 出題、保存、弱点復習、進捗、問題一覧
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
