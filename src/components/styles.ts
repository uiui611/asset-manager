import { css } from "lit";
export const shared = css`
  :host {
    display: block;
    color: var(--ink, #23372e);
    font-family: var(--font, Inter, "Segoe UI", "Noto Sans JP", sans-serif);
    font-size: 14px;
    line-height: 1.6;
    --line: #e2e8e2;
    --muted: #7a877d;
    --green: #2e644c;
  }
  * {
    box-sizing: border-box;
  }
  button,
  input,
  select,
  textarea {
    font: inherit;
  }
  button,
  a,
  input,
  select,
  textarea {
    outline-offset: 4px;
  }
  button {
    cursor: pointer;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: white;
    color: inherit;
    padding: 9px 15px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background 0.15s;
  }
  button:hover:not(:disabled) {
    background: #edf3ed;
    border-color: #bdcfc1;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .primary {
    background: var(--green);
    color: white;
    border-color: var(--green);
  }
  .primary:hover:not(:disabled) {
    background: #234e3a;
  }
  .danger {
    color: #a64039;
  }
  .quiet {
    border: 0;
    background: transparent;
  }
  .small {
    padding: 5px 10px;
    font-size: 12px;
  }
  input,
  select,
  textarea {
    border: 1px solid #d9e1d9;
    border-radius: 7px;
    background: white;
    color: inherit;
    padding: 9px 11px;
    min-width: 0;
  }
  input[type="checkbox"] {
    accent-color: var(--green);
    width: 16px;
    height: 16px;
  }
  input[type="range"] {
    accent-color: var(--green);
    padding: 0;
    width: 100%;
  }
  textarea {
    resize: vertical;
    min-height: 90px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: #5e7165;
  }
  label.check {
    flex-direction: row;
    align-items: center;
  }
  h1,
  h2,
  h3,
  p {
    margin: 0;
  }
  h1 {
    font-size: 29px;
    font-weight: 650;
    letter-spacing: -1px;
  }
  h2 {
    font-size: 20px;
    font-weight: 600;
  }
  h3 {
    font-size: 14px;
    font-weight: 600;
  }
  .muted {
    color: var(--muted);
  }
  .eyebrow {
    font-size: 10px;
    letter-spacing: 2px;
    font-weight: 650;
    color: #7b8c7d;
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .spread {
    justify-content: space-between;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  .panel {
    background: white;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 22px;
  }
  .tag {
    display: inline-flex;
    padding: 3px 8px;
    border-radius: 5px;
    background: #edf2ea;
    color: #66805a;
    font-size: 10px;
    white-space: nowrap;
  }
  .pill {
    font-size: 11px;
    background: #eff4ee;
    border-radius: 20px;
    padding: 5px 10px;
    color: #57795c;
  }
  .page-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin-bottom: 25px;
  }
  .page-head p {
    margin-top: 5px;
    color: var(--muted);
    font-size: 12px;
  }
  .empty {
    text-align: center;
    padding: 70px 24px;
    color: var(--muted);
  }
  .empty h2 {
    color: #3c5545;
    margin: 14px 0 8px;
  }
  .empty p {
    max-width: 440px;
    margin: 0 auto 20px;
    font-size: 13px;
  }
  .empty-icon {
    display: inline-flex;
    width: 70px;
    height: 70px;
    border-radius: 18px;
    background: #edf3e9;
    align-items: center;
    justify-content: center;
    color: #678761;
  }
  .notice {
    padding: 12px 16px;
    border: 1px solid #dce6d6;
    background: #f1f6ed;
    border-radius: 8px;
    font-size: 12px;
    color: #607554;
  }
  .error {
    background: #fff0ee;
    color: #983f37;
    border-color: #edd2cd;
  }
  .divider {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 0;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 13px;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: #172b2455;
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .dialog {
    background: #fafcf8;
    max-height: 90vh;
    overflow: auto;
    width: min(720px, 100%);
    padding: 27px;
    border-radius: 15px;
    box-shadow: 0 24px 80px #132b2430;
  }
  .dialog footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
  .dialog h2 {
    margin-bottom: 20px;
  }
  .checker {
    background-color: #f5f6ef;
    background-image:
      linear-gradient(45deg, #e9ede5 25%, transparent 25%),
      linear-gradient(-45deg, #e9ede5 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e9ede5 75%),
      linear-gradient(-45deg, transparent 75%, #e9ede5 75%);
    background-size: 20px 20px;
    background-position:
      0 0,
      0 10px,
      10px -10px,
      -10px 0;
  }
  svg {
    flex-shrink: 0;
  }
  a {
    color: var(--green);
  }
  code {
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .form-footer {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .toolbar {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .toolbar input {
    flex: 1;
  }
  .scroll {
    overflow: auto;
  }
  canvas {
    image-rendering: pixelated;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
  @media (max-width: 760px) {
    .page-head {
      align-items: flex-start;
      flex-direction: column;
    }
    h1 {
      font-size: 25px;
    }
    .grid2 {
      grid-template-columns: 1fr;
    }
    .dialog {
      padding: 18px;
    }
    .overlay {
      padding: 10px;
    }
  }
`;
