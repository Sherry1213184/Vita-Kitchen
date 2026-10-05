CREATE TABLE `dishes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`price` integer NOT NULL,
	`available` integer DEFAULT 1 NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`allergens` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user` text NOT NULL,
	`name` text NOT NULL,
	`room` text NOT NULL,
	`note` text NOT NULL,
	`items` text NOT NULL,
	`total` integer NOT NULL,
	`status` integer DEFAULT 0 NOT NULL,
	`photo` text DEFAULT '' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`user` text NOT NULL,
	`name` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_order_id_unique` ON `reviews` (`order_id`);