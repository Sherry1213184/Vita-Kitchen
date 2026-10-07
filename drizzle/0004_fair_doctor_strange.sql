CREATE TABLE `ballots` (
	`poll_id` text NOT NULL,
	`user` text NOT NULL,
	`choices` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`poll_id`, `user`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`happened_on` text NOT NULL,
	`people` text NOT NULL,
	`image` text NOT NULL,
	`author` text NOT NULL,
	`author_name` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`fingerprint` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memories_created_id` ON `memories` (`created`,`id`);--> statement-breakpoint
CREATE INDEX `memories_image` ON `memories` (`image`);--> statement-breakpoint
CREATE TABLE `polls` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`options` text NOT NULL,
	`creator` text NOT NULL,
	`created` text NOT NULL,
	`fingerprint` text NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
