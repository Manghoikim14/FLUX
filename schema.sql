CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    friend_code TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL DEFAULT 'en',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sender_id, recipient_id),
    CHECK (sender_id <> recipient_id)
);

CREATE TABLE IF NOT EXISTS friendships (
    user_low UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_low, user_high),
    CHECK (user_low < user_high)
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    is_forwarded BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (sender_id <> recipient_id)
);

CREATE TABLE IF NOT EXISTS chat_history_clears (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cleared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, peer_id),
    CHECK (user_id <> peer_id)
);

CREATE TABLE IF NOT EXISTS chat_message_hides (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, message_id)
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
    ON messages (sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS messages_expiry_idx
    ON messages (expires_at)
    WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_scheduled_for_idx
    ON messages (scheduled_for)
    WHERE scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS collaborative_documents (
    room_id TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
