import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, MessageCircle, Send, Users } from 'lucide-react';
import {
  acceptFriendRequest,
  getFriendRequests,
  getFriends,
  login,
  register,
  requestFriend,
} from './services/api';
import { connectSocket } from './services/socket';
import ChatBubble from './components/ChatBubble';
import DocumentEditor from './components/DocumentEditor';
import FriendRequest from './components/FriendRequest';
import LanguageSelect from './components/LanguageSelect';
import './App.css';

const savedSession = (() => {
  try {
    return JSON.parse(localStorage.getItem('chat-session') || 'null');
  } catch {
    return null;
  }
})();

export default function App() {
  const [session, setSession] = useState(savedSession);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [activeFriend, setActiveFriend] = useState(null);
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(0);
  const [showDocument, setShowDocument] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authLanguage, setAuthLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endOfMessages = useRef(null);

  const refreshContacts = useCallback(async (token) => {
    const [friendResult, requestResult] = await Promise.all([
      getFriends(token),
      getFriendRequests(token),
    ]);
    setFriends(friendResult.friends);
    setRequests(requestResult.requests);
  }, []);

  useEffect(() => {
    if (!session?.token) return undefined;
    let active = true;
    const client = connectSocket(session.token);
    setSocket(client);
    refreshContacts(session.token).catch((loadError) => {
      if (active) setError(loadError.message);
    });
    client.on('connect_error', (connectError) => {
      if (active) setError(connectError.message);
    });
    client.on('chat:message', (message) => {
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    });
    client.on('chat:message-deleted', ({ id }) => {
      setMessages((current) => current.filter((message) => message.id !== id));
    });
    return () => {
      active = false;
      client.disconnect();
      setSocket(null);
    };
  }, [session, refreshContacts]);

  useEffect(() => {
    if (!socket || !activeFriend) {
      setMessages([]);
      return;
    }
    socket.emit('chat:join', { peerId: activeFriend.id }, (result) => {
      if (result.error) setError(result.error);
      else {
        setError('');
        setMessages(result.messages);
      }
    });
    setShowDocument(false);
  }, [socket, activeFriend]);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const data = {
      email: form.get('email'),
      password: form.get('password'),
    };
    if (authMode === 'register') {
      data.displayName = form.get('displayName');
      data.language = form.get('language');
    }
    try {
      const result = await (authMode === 'register' ? register(data) : login(data));
      localStorage.setItem('chat-session', JSON.stringify(result));
      setSession(result);
    } catch (authError) {
      setError(authError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleFriendRequest(code) {
    await requestFriend(session.token, code);
    await refreshContacts(session.token);
  }

  async function handleAccept(requestId) {
    const result = await acceptFriendRequest(session.token, requestId);
    await refreshContacts(session.token);
    setActiveFriend(result.user);
  }

  function sendMessage(event) {
    event.preventDefault();
    if (!draft.trim() || !socket || !activeFriend) return;
    const content = draft.trim();
    setError('');
    const eventName = scheduledFor ? 'chat:schedule' : 'chat:send';
    const payload = {
      peerId: activeFriend.id,
      content,
      ttlSeconds: Number(ttlSeconds),
      ...(scheduledFor ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
    };
    socket.emit(eventName, payload, (result) => {
      if (result.error) setError(result.error);
      else {
        setDraft('');
        setScheduledFor('');
      }
    });
  }

  function signOut() {
    localStorage.removeItem('chat-session');
    setSession(null);
    setActiveFriend(null);
    setSocket(null);
    setMessages([]);
  }

  if (!session) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark"><MessageCircle size={22} /></div>
          <p className="eyebrow">YOUR SPACE TO CONNECT</p>
          <h1>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">Private conversations, made a little more personal.</p>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === 'register' && (
              <>
                <label>Display name<input name="displayName" required maxLength={60} /></label>
                <LanguageSelect value={authLanguage} onChange={setAuthLanguage} label="Your language" />
              </>
            )}
            <label>Email<input type="email" name="email" required autoComplete="email" /></label>
            <label>Password<input type="password" name="password" required minLength={8} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} /></label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={busy}>{busy ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="text-button auth-switch" onClick={() => { setError(''); setAuthMode(authMode === 'login' ? 'register' : 'login'); }}>
            {authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand-mark"><MessageCircle size={21} /></div>
          <div><strong>Chat Room</strong><span>Good conversations start here</span></div>
          <button className="icon-button subtle" onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button>
        </header>
        <div className="profile-card">
          <div className="avatar">{session.user.displayName.slice(0, 1).toUpperCase()}</div>
          <div><strong>{session.user.displayName}</strong><span>Your code: {session.user.friendCode}</span></div>
        </div>
        <FriendRequest onSubmit={handleFriendRequest} />
        {requests.length > 0 && (
          <section className="contact-section">
            <h2>Friend requests <span>{requests.length}</span></h2>
            {requests.map((request) => (
              <div className="request-item" key={request.id}>
                <span>{request.user.displayName}</span>
                <button className="text-button" onClick={() => handleAccept(request.id)}>Accept</button>
              </div>
            ))}
          </section>
        )}
        <section className="contact-section friends-section">
          <h2><Users size={15} /> Friends <span>{friends.length}</span></h2>
          {friends.length === 0 ? <p className="empty-sidebar">Add a friend to start chatting.</p> : friends.map((friend) => (
            <button
              className={`friend-item ${activeFriend?.id === friend.id ? 'friend-item-active' : ''}`}
              key={friend.id}
              onClick={() => setActiveFriend(friend)}
            >
              <span className="avatar small">{friend.displayName.slice(0, 1).toUpperCase()}</span>
              <span>{friend.displayName}</span>
              <i className="online-dot" />
            </button>
          ))}
        </section>
      </aside>

      <section className="chat-panel">
        {activeFriend ? (
          <>
            <header className="chat-header">
              <div className="avatar">{activeFriend.displayName.slice(0, 1).toUpperCase()}</div>
              <div className="chat-person"><strong>{activeFriend.displayName}</strong><span>Connected</span></div>
              <button className={`text-button notes-toggle ${showDocument ? 'selected' : ''}`} onClick={() => setShowDocument(!showDocument)}>
                Shared notes
              </button>
            </header>
            <div className="conversation-layout">
              <section className="conversation">
                <div className="message-list">
                  {messages.length === 0 && <div className="conversation-empty"><div className="empty-icon"><MessageCircle /></div><h2>Say hello to {activeFriend.displayName}</h2><p>Your conversation starts here.</p></div>}
                  {messages.map((message) => (
                    <ChatBubble key={message.id} message={message} mine={message.senderId === session.user.id} targetLanguage={session.user.language} />
                  ))}
                  <div ref={endOfMessages} />
                </div>
                <form className="composer" onSubmit={sendMessage}>
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message..." maxLength={4000} aria-label="Message" />
                  <input
                    className="schedule-input"
                    type="datetime-local"
                    min={new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    value={scheduledFor}
                    onChange={(event) => setScheduledFor(event.target.value)}
                    aria-label="Optional scheduled send time"
                    title="Set a future time to schedule this message"
                  />
                  <select value={ttlSeconds} onChange={(event) => setTtlSeconds(event.target.value)} aria-label="Message expiry">
                    <option value={0}>Keep message</option>
                    <option value={60}>Delete in 1 min</option>
                    <option value={3600}>Delete in 1 hour</option>
                    <option value={86400}>Delete in 1 day</option>
                  </select>
                  <button className="send-button" disabled={!draft.trim()} aria-label={scheduledFor ? 'Schedule message' : 'Send message'}><Send size={17} /></button>
                </form>
                {error && <p className="composer-error">{error}</p>}
              </section>
              {showDocument && <DocumentEditor socket={socket} peerId={activeFriend.id} onClose={() => setShowDocument(false)} />}
            </div>
          </>
        ) : (
          <div className="welcome-panel">
            <div className="welcome-art"><MessageCircle size={42} /></div>
            <p className="eyebrow">A LITTLE CLOSER, EVEN FAR AWAY</p>
            <h1>Make room for<br />good conversations.</h1>
            <p>Choose a friend to open your chat, or send a friend request to get started.</p>
          </div>
        )}
      </section>
    </main>
  );
}
