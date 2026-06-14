// Login OIDC (Zitadel self-host, auth.hal9klabs.com) — fluxo Authorization Code + PKCE
// para a PWA (cliente público, sem segredo). O access token (JWT) vai como Bearer
// nas chamadas à API; o backend valida via JWKS + allowlist. offline_access dá
// refresh token (renovação sem novo login). Ver memória [[auth-zitadel]].
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

const ISSUER = 'https://auth.hal9klabs.com';
const CLIENT_ID = '377443508467859459'; // app "BigBag PWA" (client_id é público, não é segredo)

const mgr = new UserManager({
  authority: ISSUER,
  client_id: CLIENT_ID,
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'openid profile email offline_access',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  automaticSilentRenew: true,   // usa o refresh token (offline_access) p/ renovar
  monitorSession: false,        // evita iframes cross-subdomínio (cookies)
});

export const oidcLogin = () => mgr.signinRedirect();              // → redireciona ao Zitadel
export const oidcCallback = () => mgr.signinRedirectCallback();   // trata o /callback (troca código por tokens)
export async function oidcLogout() {
  try { await mgr.signoutRedirect(); } catch { await mgr.removeUser(); window.location.href = '/'; }
}
export const oidcUser = () => mgr.getUser();                      // Promise<User|null>
// access token válido (renova com refresh token se expirou); null se sem sessão.
export async function oidcAccessToken() {
  try {
    let u = await mgr.getUser();
    if (u && u.expired) { try { u = await mgr.signinSilent(); } catch { return null; } }
    return u && !u.expired ? u.access_token : null;
  } catch { return null; }
}
