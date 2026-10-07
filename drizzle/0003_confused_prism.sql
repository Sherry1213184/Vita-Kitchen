CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`location` text NOT NULL,
	`notes` text NOT NULL,
	`status` text NOT NULL,
	`creator` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`activity_id` text NOT NULL,
	`user` text NOT NULL,
	`choice` text NOT NULL,
	PRIMARY KEY(`activity_id`, `user`),
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expense_shares` (
	`expense_id` text NOT NULL,
	`user` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`settled` integer DEFAULT 0 NOT NULL,
	`settled_by` text,
	`settled_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`expense_id`, `user`),
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`payer` text NOT NULL,
	`payer_name` text NOT NULL,
	`activity_id` text,
	`spent_on` text NOT NULL,
	`note` text NOT NULL,
	`creator` text NOT NULL,
	`created` text NOT NULL,
	`fingerprint` text NOT NULL,
	`voided` integer DEFAULT 0 NOT NULL,
	`voided_by` text,
	`voided_at` text,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE no action
);
