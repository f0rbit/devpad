CREATE TABLE `commit_detail` (
	`sha` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`url` text NOT NULL,
	`avatar_url` text,
	`author_user` text NOT NULL,
	`author_name` text,
	`author_email` text NOT NULL,
	`date` text NOT NULL
);
