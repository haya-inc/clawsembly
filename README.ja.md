# Clawsembly

> 上流のコーディングエージェントを、埋め込み側アプリケーションが制御する
> ホスト境界の内側で、ブラウザローカルに実行する。証拠(evidence)で
> ゲートされ、OpenClaw が最初の対応上流。

[English README](README.md) /
[プロジェクトページ](https://haya-inc.github.io/clawsembly/)

Clawsembly は、上流のコーディングエージェントをブラウザローカルで実行する
ための、証拠ゲート付き埋め込みレイヤーです。
[OpenClaw](https://github.com/openclaw/openclaw) が最初の対応上流です:
公開された正確なパッケージを公開互換性証拠に束縛し、その証拠が検証される
までは起動を拒否します。現在、追跡中の全リリースは **probing**
(正確なアーティファクトの静的検査は済んでいるが、オーナー承認のランタイム
証拠がまだ存在しないため、検証済み起動はブロックされたまま)という状態です。
Clawsembly は実験的なシングルメンテナのプロジェクトであり、OpenClaw
プロジェクトとは無関係で、承認も受けていません。

## 今日動くもの / ブロックされているもの

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| ゼロインストールの promotion-policy チェック | **動く** | `node examples/release-policy/check.mjs --observe` が依存なし・数秒で現在の判定を表示 |
| ホスト済みプロジェクトページ | **動く** | [ライブレポートと許可プロンプトのデモ](https://haya-inc.github.io/clawsembly/)(不活性なローカルブローカー相手に承認・拒否・失効・監査エクスポート) |
| npm アルファパッケージ | **公開済み** | `npm install @haya-inc/clawsembly@alpha` — SHA-512 整合性と Sigstore provenance 付き |
| 証拠ゲート付きブートのデモ | **動く** | [SDK ホスト例](examples/sdk-host/README.md)が pinned レポートを検証し `Provider boot blocked` を表示(未検証リリースの拒否はセキュリティ機能が正しく動いている状態) |
| 検証済み BrowserPod ブート | **ブロック中** | BrowserPod 2.12.1 の Node は 22.15.0 で 22.19 ベースライン未満のため、readiness probe が `node_baseline_unsatisfied` で fail closed(ベンダーへ報告済み)。オーナー承認のランタイム証拠待ち([#6](https://github.com/haya-inc/clawsembly/issues/6)) |
| ライブプロバイダーのスモークテスト | **ブロック中** | ゲート付き経路は実装済みだが未実行 |
| 性能ベースライン | **ブロック中** | 未計測([#8](https://github.com/haya-inc/clawsembly/issues/8)) |

## 試す

API キー不要の3ステップ:

1. **プロモーションゲートの判定を見る**(Node 22.19+ のみ、インストール不要):

   ```bash
   git clone https://github.com/haya-inc/clawsembly
   cd clawsembly
   node examples/release-policy/check.mjs --observe
   ```

2. **ホスト済みプロジェクトページを開く**:
   <https://haya-inc.github.io/clawsembly/>。npm の `latest`・前安定版・
   `beta` の各 OpenClaw チャネルを追跡し、不活性なローカルブローカー相手に
   許可プロンプトのコンポーネントを動かせます(ランタイムのブートも、
   ホスト権限の呼び出しも発生しません)。

3. **公開済みアルファをインストールし、証拠ゲートが拒否する様子を見る**:

   ```bash
   npm install @haya-inc/clawsembly@alpha
   ```

   その後は[コピーして使える SDK ホストスターター](examples/sdk-host/README.md)
   か[デプロイ済みコピー](https://haya-inc.github.io/clawsembly/sdk-host/)へ。
   正確な HTTPS 互換性レポートを取得し、pinned SHA-256 とアーティファクト・
   ランタイム同一性を検証した上で、レポートが `probing` である限り
   BrowserPod を呼ばずに `Provider boot blocked` を表示します。

## ランタイムとコストの開示

Clawsembly がコミットするブラウザローカルランタイムは
[BrowserPod](https://browserpod.io/docs/overview) で、プロプライエタリかつ
従量課金です。ダウンストリームの各デプロイは自前の BrowserPod API キーを
必要とします。無料枠は非商用・要クレジット表記で、OSS 向けグラント制度も
存在します。Clawsembly は未検証リリースにランタイムトークンを消費しません:
`bootVerifiedEmbed` は証拠が欠けている間、トークン消費前にブロックします。
詳細は[デプロイ要件](docs/deployment.md)と
[ADR 0002](docs/decisions/0002-commercial-browser-runtime.md) を参照して
ください。

## ドキュメント

設計・セキュリティモデル・ロードマップ・各種決定記録(ADR)を含む詳細は
[英語版 README](README.md) と[ドキュメント索引](docs/README.md) を正とします。
主要な入口:

- [プロジェクトビジョン](docs/vision.md)
- [OSS 戦略](docs/oss-strategy.md)
- [検証済み埋め込み契約](docs/embedding.md)
- [上流バインディング契約](docs/upstream-binding-contract.md)
- [ADR 0004: 上流可搬な埋め込み境界](docs/decisions/0004-upstream-portable-embedding-boundary.md)
- [ADR 0005: 参照エージェントと二つの成長パス](docs/decisions/0005-reference-agent-growth-paths.md)
- [コントリビューションガイド](CONTRIBUTING.md)(コミットには DCO 署名が必要です)

## ライセンス

[MIT](LICENSE)
