import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, Check, LogOut, MessageCircle, Send, Users } from 'lucide-react';
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
  const [notifications, setNotifications] = useState([]);
  const [currentPage, setCurrentPage] = useState('chat');
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
  const activeFriendRef = useRef(activeFriend);
  const friendsRef = useRef(friends);
  activeFriendRef.current = activeFriend;
  friendsRef.current = friends;

  function addNotification(notification) {
    setNotifications((current) => [
      notification,
      ...current.filter((item) => item.id !== notification.id),
    ].slice(0, 50));
  }

  const refreshContacts = useCallback(async (token) => {
    const [friendResult, requestResult] = await Promise.all([
      getFriends(token),
      getFriendRequests(token),
    ]);
    setFriends(friendResult.friends);
    setRequests(requestResult.requests);
    setNotifications((current) => {
      const pendingRequestIds = new Set(requestResult.requests.map((request) => request.id));
      const retained = current.filter((item) => (
        item.kind !== 'friend-request' || pendingRequestIds.has(item.requestId)
      ));
      const currentIds = new Set(retained.map((item) => item.id));
      const pending = requestResult.requests
        .filter((request) => !currentIds.has(`friend-request:${request.id}`))
        .map((request) => ({
          id: `friend-request:${request.id}`,
          kind: 'friend-request',
          requestId: request.id,
          peerId: request.user.id,
          title: `${request.user.displayName} sent you a friend request`,
          createdAt: request.createdAt,
          read: false,
        }));
      return [...pending, ...retained].slice(0, 50);
    });
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
    client.on('notification:friend-request', (request) => {
      setRequests((current) => current.some((item) => item.id === request.requestId)
        ? current
        : [...current, {
          id: request.requestId,
          createdAt: request.createdAt,
          user: {
            id: request.from.id,
            displayName: request.from.displayName,
            friendCode: '',
          },
        }]);
      addNotification({
        id: `friend-request:${request.requestId}`,
        kind: 'friend-request',
        requestId: request.requestId,
        peerId: request.from.id,
        title: `${request.from.displayName} sent you a friend request`,
        createdAt: request.createdAt,
        read: false,
      });
    });
    client.on('notification:friend-accepted', (notification) => {
      addNotification({
        id: `friend-accepted:${notification.requestId}`,
        kind: 'friend-accepted',
        peerId: notification.peerId,
        title: `${notification.displayName} accepted your friend request`,
        createdAt: notification.createdAt,
        read: false,
      });
    });
    client.on('notification:new-message', (notification) => {
      if (activeFriendRef.current?.id === notification.peerId && document.visibilityState === 'visible') return;
      const friendName = friendsRef.current.find((friend) => friend.id === notification.peerId)?.displayName || 'New message';
      addNotification({
        id: `message:${notification.messageId}`,
        kind: 'message',
        peerId: notification.peerId,
        title: `${friendName}: ${notification.preview}`,
        createdAt: new Date().toISOString(),
        read: false,
      });
    });
    client.on('friends:updated', () => {
      refreshContacts(session.token).catch((loadError) => {
        if (active) setError(loadError.message);
      });
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
    setNotifications((current) => current.filter((item) => item.id !== `friend-request:${requestId}`));
    setActiveFriend(result.user);
    setCurrentPage('chat');
  }

  async function openNotification(notification) {
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, read: true } : item
    )));
    if (notification.kind === 'friend-request') return;

    const friend = friends.find((item) => item.id === notification.peerId);
    if (friend) {
      setActiveFriend(friend);
      setCurrentPage('chat');
    } else if (notification.kind === 'friend-accepted') {
      try {
        await refreshContacts(session.token);
        setActiveFriend({
          id: notification.peerId,
          displayName: notification.title.split(' accepted ')[0],
        });
        setCurrentPage('chat');
      } catch (loadError) {
        setError(loadError.message);
      }
    }
  }

  const unreadNotifications = notifications.filter((notification) => !notification.read).length;

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
          <div className="notification-anchor">
            <button
              className="icon-button subtle notification-button"
              onClick={() => setCurrentPage('notifications')}
              aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}
              aria-current={currentPage === 'notifications' ? 'page' : undefined}
            >
              <Bell size={17} />
              {unreadNotifications > 0 && <span className="notification-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
            </button>
          </div>
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
              onClick={() => { setActiveFriend(friend); setCurrentPage('chat'); }}
            >
              <span className="avatar small">{friend.displayName.slice(0, 1).toUpperCase()}</span>
              <span>{friend.displayName}</span>
              <i className="online-dot" />
            </button>
          ))}
        </section>
      </aside>

      <section className="chat-panel">
        {currentPage === 'notifications' ? (
          <section className="notifications-page">
            <header className="notifications-page-header">
              <button className="text-button notifications-back" onClick={() => setCurrentPage('chat')}>
                <ArrowLeft size={16} /> Back to chat
              </button>
              <div>
                <p className="eyebrow">YOUR UPDATES</p>
                <h1>Notifications</h1>
                <p className="notifications-subtitle">
                  {unreadNotifications ? `${unreadNotifications} unread` : 'You’re all caught up'}
                </p>
              </div>
              {unreadNotifications > 0 && (
                <button className="text-button" onClick={() => setNotifications((current) => current.map((item) => ({ ...item, read: true })))}>
                  Mark all read
                </button>
              )}
            </header>
            <div className="notifications-list">
              {notifications.length === 0 ? (
                <div className="notifications-empty">
                  <div className="empty-icon"><Bell size={22} /></div>
                  <h2>No notifications yet</h2>
                  <p>Friend requests and new messages will show up here.</p>
                </div>
              ) : notifications.map((notification) => (
                <article className={`notification-card ${notification.read ? '' : 'notification-card-unread'}`} key={notification.id}>
                  <button className="notification-card-content" onClick={() => openNotification(notification)}>
                    <span className="notification-card-icon">
                      {notification.kind === 'friend-request' ? <Users size={17} /> : <MessageCircle size={17} />}
                    </span>
                    <span className="notification-card-copy">
                      <strong>{notification.title}</strong>
                      <time>{new Date(notification.createdAt).toLocaleString()}</time>
                    </span>
                    {!notification.read && <span className="notification-card-unread-dot" />}
                  </button>
                  {notification.kind === 'friend-request' && (
                    <button className="notification-accept" onClick={() => handleAccept(notification.requestId)} aria-label="Accept friend request">
                      <Check size={15} />
                      Accept
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : activeFriend ? (
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
