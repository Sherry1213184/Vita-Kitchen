import {personalOrders, type OrderCursor} from '@/lib/orders';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export const db=()=> (env as any).DB as D1Database;
export const bucket=()=> (env as any).BUCKET as R2Bucket;
export class SignInRequired extends Error {}
export async function identity(){const u=await getChatGPTUser();if(!u)throw new SignInRequired('请先登录');// Site access is restricted to invited members by the platform. Every admitted member can manage this shared kitchen.
return {...u,admin:true};}
export const seeds=[
{id:'egg',name:'番茄炒蛋',description:'酸甜番茄裹着嫩鸡蛋，熟悉的家常味。',category:'素菜',price:0,available:1,image:'',allergens:'鸡蛋'},
{id:'wings',name:'可乐鸡翅',description:'小火收汁，咸甜入味。每份 4 只。',category:'荤菜',price:0,available:1,image:'',allergens:'大豆、小麦'},
{id:'rice',name:'蛋炒饭',description:'鸡蛋、葱花和米饭，热乎乎的一大碗。',category:'主食',price:0,available:1,image:'',allergens:'鸡蛋'},
{id:'potato',name:'酸辣土豆丝',description:'爽脆酸辣，配米饭刚刚好。',category:'素菜',price:0,available:1,image:'',allergens:''}];
export async function menu(){const rows=(await db().prepare('SELECT * FROM dishes').all()).results;if(rows.length)return rows.map(d=>({...d,image:d.image==='/food.jpg'?'':d.image}));await db().batch(seeds.map(d=>db().prepare('INSERT OR IGNORE INTO dishes (id,name,description,category,price,available,image,allergens) VALUES (?,?,?,?,?,?,?,?)').bind(d.id,d.name,d.description,d.category,d.price,d.available,d.image,d.allergens)));return (await db().prepare('SELECT * FROM dishes').all()).results;}

export async function kitchenData(before?: OrderCursor){
 const u=await identity();const dishes=await menu();
 const orders=(await db().prepare(u.admin?"SELECT o.*, EXISTS(SELECT 1 FROM reviews r WHERE r.order_id=o.id) AS hasReview FROM orders o WHERE o.status<4 OR o.id IN (SELECT id FROM orders WHERE status=4 ORDER BY created DESC,id DESC LIMIT 50) ORDER BY (o.status=4),o.created DESC,o.id DESC":'SELECT * FROM orders WHERE user=? ORDER BY created DESC LIMIT 100').bind(...(u.admin?[]:[u.userId])).all()).results;
 const reviews=(await db().prepare("SELECT COALESCE(NULLIF(p.name,''),r.name) AS name,r.rating,r.comment,r.created,r.order_id,p.avatar FROM reviews r LEFT JOIN profiles p ON p.user=r.user ORDER BY r.created DESC LIMIT 100").all()).results;
 const personal=await personalOrders(db(),u.userId,before);
 const profile=await db().prepare('SELECT name,room,avatar FROM profiles WHERE user=?').bind(u.userId).first();
 const friends=(await db().prepare("SELECT name,avatar FROM profiles WHERE name<>'' ORDER BY name LIMIT 200").all()).results;
 return {dishes,...personal,kitchenOrders:orders,reviews,profile,friends,admin:u.admin};
}
