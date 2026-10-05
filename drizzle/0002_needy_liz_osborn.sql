CREATE TABLE `profiles` (
	`user` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`room` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT '' NOT NULL
);
