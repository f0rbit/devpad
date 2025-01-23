-- Update 'api_key.owner_id' to be NOT NULL
ALTER TABLE api_key ADD COLUMN owner_id_temp TEXT NOT NULL;
UPDATE api_key SET owner_id_temp = owner_id; -- Copy data to temporary column
ALTER TABLE api_key DROP COLUMN owner_id; -- Drop the old column
ALTER TABLE api_key ADD COLUMN owner_id TEXT NOT NULL; -- Recreate with NOT NULL constraint
UPDATE api_key SET owner_id = owner_id_temp; -- Copy data back to the new column
ALTER TABLE api_key DROP COLUMN owner_id_temp; -- Drop the temporary column

-- Update 'api_key.hash' to be NOT NULL
ALTER TABLE api_key ADD COLUMN hash_temp TEXT NOT NULL;
UPDATE api_key SET hash_temp = hash; -- Copy data to temporary column
ALTER TABLE api_key DROP COLUMN hash; -- Drop the old column
ALTER TABLE api_key ADD COLUMN hash TEXT NOT NULL; -- Recreate with NOT NULL constraint
UPDATE api_key SET hash = hash_temp; -- Copy data back to the new column
ALTER TABLE api_key DROP COLUMN hash_temp; -- Drop the temporary column

-- Update 'project.visibility' to be NOT NULL with default 'PRIVATE'
ALTER TABLE project ADD COLUMN visibility_temp TEXT NOT NULL DEFAULT 'PRIVATE';
UPDATE project SET visibility_temp = COALESCE(visibility, 'PRIVATE'); -- Use 'PRIVATE' if NULL
ALTER TABLE project DROP COLUMN visibility; -- Drop the old column
ALTER TABLE project ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PRIVATE'; -- Recreate with constraints
UPDATE project SET visibility = visibility_temp; -- Copy data back to the new column
ALTER TABLE project DROP COLUMN visibility_temp; -- Drop the temporary column

