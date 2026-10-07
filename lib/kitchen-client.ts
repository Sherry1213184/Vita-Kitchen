export class KitchenRequestError extends Error {
  constructor(message: string, public needsSignIn = false, public status = 0) { super(message); }
}
export async function kitchenRequest(body?: object | FormData, query = '') {
  let response: Response;
  try {
    response = await fetch('/api/kitchen' + query, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body && !(body instanceof FormData) ? {'Content-Type':'application/json'} : {}) },
      ...(body ? {body: body instanceof FormData ? body : JSON.stringify(body)} : {}),
    });
  } catch { throw new KitchenRequestError('连接失败，请检查网络后重试。'); }
  if (response.status === 401 || response.redirected) {
    throw new KitchenRequestError('登录状态已失效，请重新登录。', true);
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new KitchenRequestError('暂时无法加载数据，请重试；如果持续出现，请重新登录。');
  }
  let result: any;
  try { result = await response.json(); }
  catch { throw new KitchenRequestError('返回的数据不完整，请重试。'); }
  if (!response.ok) throw new KitchenRequestError(result?.error || '保存失败，请稍后重试。', false, response.status);
  if (!result || typeof result !== 'object') throw new KitchenRequestError('返回的数据不完整，请重试。');
  return result;
}
