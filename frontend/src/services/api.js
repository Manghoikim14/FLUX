const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, { token, ...options } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

export const register = (data) => request('/auth/register', {
  method: 'POST',
  body: JSON.stringify(data),
});

export const login = (data) => request('/auth/login', {
  method: 'POST',
  body: JSON.stringify(data),
});

export const getFriends = (token) => request('/friends', { token });
export const getFriendRequests = (token) => request('/friends/requests', { token });
export const searchMessages = (token, query) => request(`/friends/search/messages?q=${encodeURIComponent(query)}`, { token });

export const requestFriend = (token, friendCode) => request('/friends/request', {
  method: 'POST',
  token,
  body: JSON.stringify({ friendCode }),
});

export const acceptFriendRequest = (token, requestId) => request(`/friends/requests/${requestId}/accept`, {
  method: 'POST',
  token,
});
