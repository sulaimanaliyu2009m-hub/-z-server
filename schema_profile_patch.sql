-- 1. Add Profile Details to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(100) DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(255) DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;

-- 2. Add Status column to follows for private account approvals
ALTER TABLE follows ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'accepted' CHECK (status IN ('accepted', 'pending'));

-- 3. Prevent self-follows
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_no_self_follow'
    ) THEN 
        ALTER TABLE follows ADD CONSTRAINT chk_no_self_follow CHECK (follower_id != following_id);
    END IF; 
END $$;

-- 4. Create blocks table to respect user safety
CREATE TABLE IF NOT EXISTS blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
