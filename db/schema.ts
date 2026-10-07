import {sqliteTable,text,integer,index,primaryKey} from 'drizzle-orm/sqlite-core';
export const dishes=sqliteTable('dishes',{id:text('id').primaryKey(),name:text('name').notNull(),description:text('description').notNull(),category:text('category').notNull(),price:integer('price').notNull(),available:integer('available').notNull().default(1),image:text('image').notNull().default(''),allergens:text('allergens').notNull().default('')});
export const orders=sqliteTable('orders',{id:text('id').primaryKey(),user:text('user').notNull(),name:text('name').notNull(),room:text('room').notNull(),note:text('note').notNull(),items:text('items').notNull(),total:integer('total').notNull(),status:integer('status').notNull().default(0),photo:text('photo').notNull().default(''),created:text('created').notNull()},t=>[index('orders_user_created').on(t.user,t.created)]);
export const reviews=sqliteTable('reviews',{id:text('id').primaryKey(),orderId:text('order_id').notNull().unique(),user:text('user').notNull(),name:text('name').notNull(),rating:integer('rating').notNull(),comment:text('comment').notNull(),created:text('created').notNull()});
export const profiles=sqliteTable('profiles',{user:text('user').primaryKey(),name:text('name').notNull().default(''),room:text('room').notNull().default(''),avatar:text('avatar').notNull().default('')});

export const activities = sqliteTable('activities', {
  id: text('id').primaryKey(), title: text('title').notNull(), kind: text('kind').notNull(),
  startsOn: text('starts_on').notNull(), endsOn: text('ends_on').notNull(),
  location: text('location').notNull(), notes: text('notes').notNull(), status: text('status').notNull(),
  creator: text('creator').notNull(), created: text('created').notNull(), updated: text('updated').notNull(),
  revision: integer('revision').notNull().default(0), fingerprint: text('fingerprint').notNull(),
});
export const attendance = sqliteTable('attendance', {
  activityId: text('activity_id').notNull().references(() => activities.id),
  user: text('user').notNull(), choice: text('choice').notNull(),
}, t => [primaryKey({ columns: [t.activityId, t.user] })]);
export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(), title: text('title').notNull(), amount: integer('amount').notNull(),
  currency: text('currency').notNull(), payer: text('payer').notNull(), payerName: text('payer_name').notNull(),
  activityId: text('activity_id').references(() => activities.id), spentOn: text('spent_on').notNull(),
  note: text('note').notNull(), creator: text('creator').notNull(), created: text('created').notNull(),
  fingerprint: text('fingerprint').notNull(), voided: integer('voided').notNull().default(0),
  voidedBy: text('voided_by'), voidedAt: text('voided_at'),
});
export const expenseShares = sqliteTable('expense_shares', {
  expenseId: text('expense_id').notNull().references(() => expenses.id), user: text('user').notNull(),
  name: text('name').notNull(), amount: integer('amount').notNull(), settled: integer('settled').notNull().default(0),
  settledBy: text('settled_by'), settledAt: text('settled_at'), revision: integer('revision').notNull().default(0),
}, t => [primaryKey({ columns: [t.expenseId, t.user] })]);
