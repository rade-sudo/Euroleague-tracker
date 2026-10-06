export const LOGIN_PATH = '/prijava'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

// Ako sesija istekne usred rada (401), šaljemo korisnika na prijavu.
// Login stranica to isključuje sa redirectOnUnauthorized: false.
export async function api(path, { redirectOnUnauthorized = true, ...options } = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch {
    throw new ApiError('Server nije dostupan.', 0)
  }
  if (response.status === 401 && redirectOnUnauthorized) {
    // replace, da tabela ne ostane u istoriji za dugme "Nazad".
    window.location.replace(LOGIN_PATH)
  }
  if (response.status === 204) return null
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      body?.error ?? 'API ne odgovara. Da li je pokrenut (npm run dev)?',
      response.status,
    )
  }
  return body
}
