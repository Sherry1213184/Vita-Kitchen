import Kitchen from './kitchen';
import {getChatGPTUser,chatGPTSignInPath} from './chatgpt-auth';
import {kitchenData} from '@/lib/kitchen';
export const dynamic='force-dynamic';
export default async function Page(){const u=await getChatGPTUser();let initialData=null;let initialError='';if(u){try{initialData=await kitchenData();}catch(e){console.error(e);initialError='暂时无法加载，请稍后重试。';}}return <Kitchen signedIn={!!u} signIn={chatGPTSignInPath('/')} initialData={initialData} initialError={initialError}/>;}
