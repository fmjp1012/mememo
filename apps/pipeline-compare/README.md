# Pipeline Compare App

問題読み取り・解説生成パイプラインを、学習本体アプリから分離して確認するローカル検証用アプリです。

## Local Dev

```sh
npm run dev:pipeline
```

Open `http://127.0.0.1:5176/`.

## Pages

- `#/compare`: 既存JSONの問題単位で Local OCR / GPT Image Read / GPT Read + Explanation を比較
- `#/guide`: PDFからJSON反映までの流れ、判断基準、履歴フィールドを視覚化
