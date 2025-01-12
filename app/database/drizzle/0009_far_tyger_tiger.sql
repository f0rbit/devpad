-- Update 'project' table
ALTER TABLE project ADD COLUMN deleted_temp BOOLEAN NOT NULL DEFAULT false;
UPDATE project SET deleted_temp = COALESCE(deleted, 0);
ALTER TABLE project DROP COLUMN deleted;
ALTER TABLE project ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
UPDATE project SET deleted = deleted_temp;
ALTER TABLE project DROP COLUMN deleted_temp;

-- Update 'milestone' table
ALTER TABLE milestone ADD COLUMN deleted_temp BOOLEAN NOT NULL DEFAULT false;
UPDATE milestone SET deleted_temp = COALESCE(deleted, 0);
ALTER TABLE milestone DROP COLUMN deleted;
ALTER TABLE milestone ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
UPDATE milestone SET deleted = deleted_temp;
ALTER TABLE milestone DROP COLUMN deleted_temp;

-- Update 'goal' table
ALTER TABLE goal ADD COLUMN deleted_temp BOOLEAN NOT NULL DEFAULT false;
UPDATE goal SET deleted_temp = COALESCE(deleted, 0);
ALTER TABLE goal DROP COLUMN deleted;
ALTER TABLE goal ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
UPDATE goal SET deleted = deleted_temp;
ALTER TABLE goal DROP COLUMN deleted_temp;

-- Update 'checklist' table
ALTER TABLE checklist ADD COLUMN deleted_temp BOOLEAN NOT NULL DEFAULT false;
UPDATE checklist SET deleted_temp = COALESCE(deleted, 0);
ALTER TABLE checklist DROP COLUMN deleted;
ALTER TABLE checklist ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
UPDATE checklist SET deleted = deleted_temp;
ALTER TABLE checklist DROP COLUMN deleted_temp;

-- Update 'checklist_item' table
ALTER TABLE checklist_item ADD COLUMN deleted_temp BOOLEAN NOT NULL DEFAULT false;
UPDATE checklist_item SET deleted_temp = COALESCE(deleted, 0);
ALTER TABLE checklist_item DROP COLUMN deleted;
ALTER TABLE checklist_item ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
UPDATE checklist_item SET deleted = deleted_temp;
ALTER TABLE checklist_item DROP COLUMN deleted_temp;

-- Update 'codebase_tasks' table
ALTER TABLE codebase_tasks ADD COLUMN deleted_temp BOOLEAN NOT NULL DEFAULT false;
UPDATE codebase_tasks SET deleted_temp = COALESCE(deleted, 0);
ALTER TABLE codebase_tasks DROP COLUMN deleted;
ALTER TABLE codebase_tasks ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
UPDATE codebase_tasks SET deleted = deleted_temp;
ALTER TABLE codebase_tasks DROP COLUMN deleted_temp;

-- Update 'tag' table
ALTER TABLE tag ADD COLUMN deleted_temp BOOLEAN NOT NULL DEFAULT false;
UPDATE tag SET deleted_temp = COALESCE(deleted, 0);
ALTER TABLE tag DROP COLUMN deleted;
ALTER TABLE tag ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false;
UPDATE tag SET deleted = deleted_temp;
ALTER TABLE tag DROP COLUMN deleted_temp;

