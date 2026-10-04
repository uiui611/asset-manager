CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  metadata JSONB NOT NULL,
  object_key TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'green'
);
INSERT INTO tags (id,name) VALUES
('image','画像'),('audio','音声'),('json','JSON'),
('editor-map','マップ編集'),('editor-character','キャラクター合成'),('editor-sound','効果音編集')
ON CONFLICT (id) DO NOTHING;
