import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  ArrowLeft, 
  Bell, 
  Check, 
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  Globe2,
  LockKeyhole,
  LogOut, 
  MessageCircle, 
  MoreVertical,
  Search,
  Send, 
  Settings, 
  UserRound,
  UserPlus, 
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import {
  acceptFriendRequest,
  getFriendRequests,
  getFriends,
  getSentFriendRequests,
  login,
  rejectFriendRequest,
  register,
  requestFriend,
  searchMessages,
  unfriend,
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
  const [sentRequests, setSentRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'friends' | 'notifications' | 'settings'
  const [activeFriend, setActiveFriend] = useState(null);
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatJoined, setChatJoined] = useState(false);
  const [chatLoadError, setChatLoadError] = useState('');
  const [chatMessageResults, setChatMessageResults] = useState([]);
  const [chatSearchLoading, setChatSearchLoading] = useState(false);
  const [chatSearchError, setChatSearchError] = useState('');
  const [selectedSearchResult, setSelectedSearchResult] = useState(null);
  const [chatListSearch, setChatListSearch] = useState('');
  const [showChatListSearch, setShowChatListSearch] = useState(true);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [friendsSearch, setFriendsSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [draft, setDraft] = useState('');
  const draftInput = useRef(null);
  const [scheduledFor, setScheduledFor] = useState('');
  const [scheduleIsSet, setScheduleIsSet] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(() => {
    const soon = new Date(Date.now() + 60000);
    return `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  });
  const [scheduleTime, setScheduleTime] = useState('12:00');
  const [scheduleMonth, setScheduleMonth] = useState(() => new Date());
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState(0);
  const [customTtlAmount, setCustomTtlAmount] = useState('10');
  const [customTtlUnit, setCustomTtlUnit] = useState(60);
  const [showMessageOptions, setShowMessageOptions] = useState(false);
  const [showDocument, setShowDocument] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authLanguage, setAuthLanguage] = useState('en');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unfriendingId, setUnfriendingId] = useState(null);
  const [error, setError] = useState('');

  const endOfMessages = useRef(null);
  const joinChatRef = useRef(null);
  const activeFriendRef = useRef(activeFriend);
  const friendsRef = useRef(friends);
  const activeTabRef = useRef(activeTab);

  activeFriendRef.current = activeFriend;
  friendsRef.current = friends;
  activeTabRef.current = activeTab;

  useEffect(() => {
    const input = draftInput.current;
    if (!input) return;

    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    input.scrollTop = input.scrollHeight;
  }, [draft]);

  function addNotification(notification) {
    setNotifications((current) => [
      notification,
      ...current.filter((item) => item.id !== notification.id),
    ].slice(0, 50));
  }

  const refreshContacts = useCallback(async (token) => {
    const [friendResult, requestResult, sentRequestResult] = await Promise.all([
      getFriends(token),
      getFriendRequests(token),
      getSentFriendRequests(token),
    ]);
    
    setFriends((currentFriends) => {
      const existingUnreadMap = new Map(currentFriends.map((f) => [f.id, f.unreadCount || 0]));
      return friendResult.friends
        .map((friend) => ({
          ...friend,
          unreadCount: existingUnreadMap.get(friend.id) || 0,
          lastMessage: friend.lastMessage || '',
          lastMessageTime: friend.lastMessageTime || null,
        }))
        .sort((first, second) => {
          const firstTime = first.lastMessageTime ? new Date(first.lastMessageTime).getTime() : 0;
          const secondTime = second.lastMessageTime ? new Date(second.lastMessageTime).getTime() : 0;
          return secondTime - firstTime || first.displayName.localeCompare(second.displayName);
        });
    });

    setRequests(requestResult.requests);
    setSentRequests(sentRequestResult.requests);
    setNotifications((current) => {
      const pendingRequestIds = new Set(requestResult.requests.map((request) => request.id));
      const sentRequestById = new Map(sentRequestResult.requests.map((request) => [request.id, request]));
      const retained = current.filter((item) => (
        item.kind === 'friend-request'
          ? pendingRequestIds.has(item.requestId)
          : item.kind !== 'friend-request-status' || sentRequestById.get(item.requestId)?.status === item.status
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
      const statusUpdates = sentRequestResult.requests
        .filter((request) => request.status === 'accepted' || request.status === 'declined')
        .filter((request) => !currentIds.has(`friend-request-status:${request.id}`))
        .map((request) => ({
          id: `friend-request-status:${request.id}`,
          kind: 'friend-request-status',
          requestId: request.id,
          status: request.status,
          peerId: request.user.id,
          title: request.status === 'accepted'
            ? `${request.user.displayName} accepted your friend request`
            : `${request.user.displayName} declined your friend request`,
          createdAt: request.createdAt,
          read: true,
        }));
      return [...pending, ...statusUpdates, ...retained].slice(0, 50);
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
      const peerId = message.senderId === session.user.id ? message.recipientId : message.senderId;
      const isCurrentActiveChat =
        activeFriendRef.current?.id === peerId &&
        activeTabRef.current === 'chats' &&
        document.visibilityState === 'visible';

      if (activeFriendRef.current?.id === peerId) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
      }
      if (isCurrentActiveChat && message.senderId !== session.user.id) {
        client.emit('chat:read', { peerId: message.senderId });
      }

      setFriends((currentFriends) =>
        currentFriends
          .map((friend) => {
            if (friend.id === peerId) {
              const isIncoming = message.senderId !== session.user.id;
              return {
                ...friend,
                lastMessage: message.content,
                lastMessageTime: message.createdAt || new Date().toISOString(),
                unreadCount: isIncoming
                  ? isCurrentActiveChat ? 0 : (friend.unreadCount || 0) + 1
                  : friend.unreadCount || 0,
              };
            }
            return friend;
          })
          .sort((first, second) => {
            const firstTime = first.lastMessageTime ? new Date(first.lastMessageTime).getTime() : 0;
            const secondTime = second.lastMessageTime ? new Date(second.lastMessageTime).getTime() : 0;
            return secondTime - firstTime || first.displayName.localeCompare(second.displayName);
          })
      );
    });

    client.on('chat:message-deleted', ({ id }) => {
      setMessages((current) => current.filter((message) => message.id !== id));
    });

    client.on('chat:read', ({ messageIds, readAt }) => {
      if (!Array.isArray(messageIds)) return;
      const readIds = new Set(messageIds);
      setMessages((current) => current.map((message) => (
        readIds.has(message.id) ? { ...message, readAt } : message
      )));
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
        id: `friend-request-status:${notification.requestId}`,
        kind: 'friend-request-status',
        requestId: notification.requestId,
        status: 'accepted',
        peerId: notification.peerId,
        title: `${notification.displayName} accepted your friend request`,
        createdAt: notification.createdAt,
        read: false,
      });
    });

    client.on('notification:friend-rejected', (notification) => {
      addNotification({
        id: `friend-request-status:${notification.requestId}`,
        kind: 'friend-request-status',
        requestId: notification.requestId,
        status: 'declined',
        peerId: notification.peerId,
        title: `${notification.displayName} declined your friend request`,
        createdAt: notification.createdAt,
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
      setChatLoading(false);
      setChatJoined(false);
      setChatLoadError('');
      return;
    }
    let cancelled = false;
    setMessages([]);
    setChatLoading(true);
    setChatJoined(false);
    setChatLoadError('');

    const joinChat = () => {
      if (cancelled) return;
      setChatLoading(true);
      setChatJoined(false);
      setChatLoadError('');
      socket.timeout(10000).emit('chat:join', { peerId: activeFriend.id }, (timeoutError, result) => {
        if (cancelled) return;
        if (timeoutError || !result) {
          setChatJoined(false);
          setChatLoading(false);
          setChatLoadError('Could not load this conversation. Check your connection and try again.');
          return;
        }
        if (result.error) {
          setChatJoined(false);
          setChatLoading(false);
          setChatLoadError(result.error);
          return;
        }
        if (!Array.isArray(result.messages)) {
          setChatJoined(false);
          setChatLoading(false);
          setChatLoadError('The chat returned an invalid response. Please try again.');
          return;
        }

        setError('');
        const selectedMessage = selectedSearchResult?.peerId === activeFriend.id
          ? selectedSearchResult
          : null;
        const history = selectedMessage && !result.messages.some((message) => message.id === selectedMessage.id)
          ? [...result.messages, selectedMessage].sort((first, second) => (
            new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
          ))
          : result.messages;
        setMessages((currentMessages) => {
          const uniqueMessages = new Map(currentMessages.map((message) => [message.id, message]));
          history.forEach((message) => uniqueMessages.set(message.id, message));
          return [...uniqueMessages.values()].sort((first, second) => (
            new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
          ));
        });
        if (document.visibilityState === 'visible' && activeTabRef.current === 'chats') {
          socket.emit('chat:read', { peerId: activeFriend.id });
        }
        setChatJoined(true);
        setChatLoading(false);
      });
    };

    joinChatRef.current = joinChat;
    socket.on('connect', joinChat);
    if (socket.connected) joinChat();
    setShowDocument(false);

    return () => {
      cancelled = true;
      socket.off('connect', joinChat);
      if (joinChatRef.current === joinChat) joinChatRef.current = null;
    };
  }, [socket, activeFriend, selectedSearchResult]);

  useEffect(() => {
    if (!socket || !activeFriend) return undefined;
    const markConversationRead = () => {
      if (document.visibilityState === 'visible' && activeTabRef.current === 'chats') {
        socket.emit('chat:read', { peerId: activeFriend.id });
      }
    };
    document.addEventListener('visibilitychange', markConversationRead);
    return () => document.removeEventListener('visibilitychange', markConversationRead);
  }, [socket, activeFriend]);

  useEffect(() => {
    const query = chatListSearch.trim();
    if (activeTab !== 'chats' || activeFriend || query.length < 2 || !session?.token) {
      setChatMessageResults([]);
      setChatSearchError('');
      setChatSearchLoading(false);
      return undefined;
    }

    let active = true;
    setChatSearchLoading(true);
    setChatSearchError('');
    const timer = window.setTimeout(() => {
      searchMessages(session.token, query)
        .then((result) => {
          if (active) setChatMessageResults(result.results);
        })
        .catch((searchError) => {
          if (active) {
            setChatMessageResults([]);
            setChatSearchError(searchError.message);
          }
        })
        .finally(() => {
          if (active) setChatSearchLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [session?.token, activeTab, activeFriend, chatListSearch]);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function openChat(friend, searchResult = null) {
    setActiveFriend(friend);
    setActiveTab('chats');
    setSelectedSearchResult(searchResult);
    if (searchResult) {
      setMessageSearch(chatListSearch);
      setShowMessageSearch(true);
    } else {
      setMessageSearch('');
      setShowMessageSearch(false);
    }
    setFriends((currentFriends) =>
      currentFriends.map((item) =>
        item.id === friend.id ? { ...item, unreadCount: 0 } : item
      )
    );
  }

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
    openChat(result.user);
  }

  async function handleReject(requestId) {
    setError('');
    try {
      await rejectFriendRequest(session.token, requestId);
      setRequests((current) => current.filter((request) => request.id !== requestId));
      setNotifications((current) => current.filter((item) => item.id !== `friend-request:${requestId}`));
      await refreshContacts(session.token);
    } catch (rejectError) {
      setError(rejectError.message);
    }
  }

  async function handleUnfriend(friend) {
    if (!window.confirm(`Unfriend ${friend.displayName}?`)) return;
    setError('');
    setUnfriendingId(friend.id);
    try {
      await unfriend(session.token, friend.id);
      setFriends((current) => current.filter((item) => item.id !== friend.id));
      if (activeFriendRef.current?.id === friend.id) {
        setActiveFriend(null);
        setMessages([]);
      }
    } catch (unfriendError) {
      setError(unfriendError.message);
    } finally {
      setUnfriendingId(null);
    }
  }

  async function openNotification(notification) {
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, read: true } : item
    )));
    if (notification.kind === 'friend-request') {
      setActiveTab('friends');
      return;
    }

    const friend = friends.find((item) => item.id === notification.peerId);
    if (friend) {
      openChat(friend);
    } else if (notification.kind === 'friend-request-status' && notification.status === 'accepted') {
      try {
        await refreshContacts(session.token);
        openChat({
          id: notification.peerId,
          displayName: notification.title.split(' accepted ')[0],
        });
      } catch (loadError) {
        setError(loadError.message);
      }
    }
  }

  const unreadNotifications = notifications.filter((notification) => !notification.read).length;
  const normalizedChatSearch = chatListSearch.trim().toLocaleLowerCase();
  const filteredChatFriends = friends.filter((friend) => (
    friend.displayName.toLocaleLowerCase().includes(normalizedChatSearch) ||
    (friend.lastMessage || '').toLocaleLowerCase().includes(normalizedChatSearch)
  ));
  const normalizedFriendsSearch = friendsSearch.trim().toLocaleLowerCase();
  const filteredFriends = friends.filter((friend) => (
    friend.displayName.toLocaleLowerCase().includes(normalizedFriendsSearch)
  ));
  const filteredRequests = requests.filter((request) => (
    request.user.displayName.toLocaleLowerCase().includes(normalizedFriendsSearch)
  ));
  const filteredSentRequests = sentRequests.filter((request) => (
    request.status === 'pending' &&
    request.user.displayName.toLocaleLowerCase().includes(normalizedFriendsSearch)
  ));
  const normalizedMessageSearch = messageSearch.trim().toLocaleLowerCase();
  const filteredMessages = messages.filter((message) => (
    message.content.toLocaleLowerCase().includes(normalizedMessageSearch)
  ));
  const firstScheduleWeekday = new Date(
    scheduleMonth.getFullYear(),
    scheduleMonth.getMonth(),
    1,
  ).getDay();
  const scheduleDaysInMonth = new Date(
    scheduleMonth.getFullYear(),
    scheduleMonth.getMonth() + 1,
    0,
  ).getDate();
  const scheduleToday = new Date();
  const scheduleTodayKey = `${scheduleToday.getFullYear()}-${String(scheduleToday.getMonth() + 1).padStart(2, '0')}-${String(scheduleToday.getDate()).padStart(2, '0')}`;

  function setScheduledMessageTime() {
    const dateTime = `${scheduleDate}T${scheduleTime}`;
    if (new Date(dateTime).getTime() < Date.now() + 60000) {
      setScheduleError('Choose a time at least one minute from now.');
      return;
    }
    setScheduleError('');
    setScheduledFor(dateTime);
    setScheduleIsSet(true);
    setShowSchedulePicker(false);
  }

  function sendMessage(event) {
    event.preventDefault();
    if (!draft.trim() || !socket || !activeFriend) return;
    if (!chatJoined) {
      setChatLoadError('This conversation is still connecting. Please wait and try again.');
      return;
    }
    const messageTtlSeconds = ttlSeconds === 'custom'
      ? Number(customTtlAmount) * Number(customTtlUnit)
      : Number(ttlSeconds);
    if (!Number.isInteger(messageTtlSeconds) || messageTtlSeconds < 0 || (messageTtlSeconds > 0 && messageTtlSeconds < 10)) {
      setError('Choose a deletion time of at least 10 seconds.');
      return;
    }
    const content = draft.trim();
    setError('');
    const eventName = scheduleIsSet ? 'chat:schedule' : 'chat:send';
    const payload = {
      peerId: activeFriend.id,
      content,
      ttlSeconds: messageTtlSeconds,
      ...(scheduleIsSet ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
    };
    socket.emit(eventName, payload, (result) => {
      if (result.error) setError(result.error);
      else {
        setFriends((currentFriends) =>
          currentFriends.map((f) =>
            f.id === activeFriend.id
              ? { ...f, lastMessage: `You: ${content}`, lastMessageTime: new Date().toISOString() }
              : f
          )
        );
        setDraft('');
        setScheduledFor('');
        setScheduleIsSet(false);
        setShowMessageOptions(false);
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
      <main className={`auth-page ${authMode === 'register' ? 'auth-page-register' : ''}`}>
        <section className={`auth-card ${authMode === 'register' ? 'auth-card-register' : ''}`}>
          <h1>{authMode === 'login' ? 'Welcome Back' : 'Create your account'}</h1>
          <form onSubmit={handleAuth} className="auth-form">
            {authMode === 'register' && (
              <>
                <label className="auth-field">User name<input className="auth-input" name="displayName" required maxLength={60} /></label>
                <LanguageSelect value={authLanguage} onChange={setAuthLanguage} label="Your language" />
              </>
            )}
            <label className="auth-field">Email<input className="auth-input" type="email" name="email" required autoComplete="email" /></label>
            <label className="auth-field">Password
              <span className="auth-password-field">
                <input className="auth-input" type={showPassword ? 'text' : 'password'} name="password" required minLength={8} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} />
                <button
                  type="button"
                  className="password-visibility-button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </span>
            </label>
            {authMode === 'login' && <p className="forgot-password">Forgot password?</p>}
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={busy}>{busy ? 'Please wait...' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="text-button auth-switch" onClick={() => { setError(''); setAuthMode(authMode === 'login' ? 'register' : 'login'); }}>
            {authMode === 'login'
              ? <><span>New here?</span> <span className="auth-switch-muted">Create an account</span></>
              : <><span>Already have an account?</span> <span className="auth-switch-muted">Sign in</span></>}
          </button>
          {authMode === 'login' && (
            <p className="auth-footer-caption">Private conversations, made<br />a little more personal.</p>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className={`flex flex-col h-screen bg-slate-100 font-sans max-w-md mx-auto shadow-2xl overflow-hidden border-x border-slate-200 ${activeTab === 'settings' ? 'settings-app' : ''} ${activeTab === 'friends' ? 'friends-app' : ''} ${activeTab === 'notifications' ? 'notifications-app' : ''} ${activeTab === 'chats' && !activeFriend ? 'active-chats-app' : ''} ${activeTab === 'chats' && activeFriend ? 'active-conversation-app' : ''}`}>
      
      {/* HEADER BAR */}
      <header className="app-header px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm shrink-0">
        <div className="app-header-title flex items-center space-x-2">
          {activeFriend && activeTab === 'chats' ? (
            <button onClick={() => setActiveFriend(null)} className="p-1 rounded-full hover:bg-slate-100 text-slate-600 mr-1">
              <ArrowLeft size={20} />
            </button>
          ) : activeTab === 'settings' ? (
            null
          ) : (
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
              <MessageCircle size={18} />
            </div>
          )}
          {activeFriend && activeTab === 'chats' && (
            <span className="conversation-header-avatar" aria-hidden="true">
              {activeFriend.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <h1 className="font-bold text-lg text-slate-800">
            {activeTab === 'chats' ? (activeFriend ? activeFriend.displayName : 'Active Chats') :
             activeTab === 'friends' ? 'Add Friend' :
             activeTab === 'notifications' ? 'Notifications' : 'Settings'}
          </h1>
        </div>

        {activeTab === 'settings' && (
          <button
            type="button"
            className="settings-notifications-button"
            onClick={() => setActiveTab('notifications')}
            aria-label="Open notifications"
          >
            <Bell size={17} />
          </button>
        )}

        {activeTab === 'chats' && (
          <div className="flex items-center gap-2">
            {!activeFriend ? (
              <button
                type="button"
                className={`p-2 rounded-full transition ${showChatListSearch ? 'bg-indigo-100 text-indigo-600' : 'text-slate-500 hover:bg-slate-100'}`}
                onClick={() => {
                  setShowChatListSearch((isVisible) => {
                    if (isVisible) setChatListSearch('');
                    return !isVisible;
                  });
                }}
                aria-label={showChatListSearch ? 'Close chat search' : 'Search chats and messages'}
                aria-pressed={showChatListSearch}
                title={showChatListSearch ? 'Close chat search' : 'Search chats and messages'}
              >
                <Search size={18} />
              </button>
            ) : (
              <div className="chat-menu-wrap">
                <button
                  type="button"
                  className="chat-menu-button"
                  onClick={() => setShowChatMenu((isOpen) => !isOpen)}
                  aria-label="Conversation options"
                  aria-haspopup="menu"
                  aria-expanded={showChatMenu}
                  title="Conversation options"
                >
                  <MoreVertical size={20} />
                </button>
                {showChatMenu && (
                  <div className="chat-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowMessageSearch((isVisible) => {
                          if (isVisible) setMessageSearch('');
                          return !isVisible;
                        });
                        setShowChatMenu(false);
                      }}
                    >
                      <Search size={16} />
                      <span>{showMessageSearch ? 'Close message search' : 'Search messages'}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowDocument((isVisible) => !isVisible);
                        setShowChatMenu(false);
                      }}
                    >
                      <MessageCircle size={16} />
                      <span>{showDocument ? 'Close shared notes' : 'Shared notes'}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-menu-unfriend"
                      disabled={unfriendingId === activeFriend.id}
                      onClick={() => {
                        setShowChatMenu(false);
                        handleUnfriend(activeFriend);
                      }}
                    >
                      <UserMinus size={16} />
                      <span>{unfriendingId === activeFriend.id ? 'Removing…' : 'Unfriend'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab !== 'settings' && (
          <div className="header-actions">
            <button
              type="button"
              className="header-profile"
              onClick={() => setActiveTab('settings')}
              aria-label={`Open ${session.user.displayName}'s profile`}
              title={session.user.displayName}
            >
              <span className="header-profile-avatar" aria-hidden="true">
                {session.user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="header-profile-name">{session.user.displayName}</span>
            </button>
          </div>
        )}
      </header>
     

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto bg-slate-50 relative">
        {error && activeTab !== 'chats' && (
          <p className="form-error request-action-error" role="alert">{error}</p>
        )}

        {/* 1. CHATS TAB */}
        {activeTab === 'chats' && (
          activeFriend ? (
            /* Active Conversation View */
            <div className="flex flex-col h-full">
              {showMessageSearch && (
                <label className="search-field chat-message-search">
                  <Search size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={messageSearch}
                    onChange={(event) => setMessageSearch(event.target.value)}
                    placeholder="Search messages in this chat"
                    aria-label="Search messages in this chat"
                    autoFocus
                  />
                </label>
              )}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 active-conversation-messages">
                {chatLoading && messages.length === 0 && (
                  <p className="search-empty" role="status">Loading conversation…</p>
                )}
                {chatLoadError && (
                  <div className="chat-load-error" role="alert">
                    <p>{chatLoadError}</p>
                    <button type="button" onClick={() => joinChatRef.current?.()}>
                      Try again
                    </button>
                  </div>
                )}
                {!chatLoading && !chatLoadError && messages.length === 0 && (
                  <div className="text-center text-slate-400 my-auto py-12">
                    <MessageCircle size={36} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Say hello to {activeFriend.displayName}!</p>
                  </div>
                )}
                {messages.length > 0 && filteredMessages.length === 0 && (
                  <p className="search-empty">No messages match “{messageSearch}”.</p>
                )}
                {filteredMessages.map((message) => (
                  <ChatBubble 
                    key={message.id} 
                    message={message} 
                    mine={message.senderId === session.user.id} 
                    peerName={activeFriend.displayName}
                    targetLanguage={session.user.language} 
                  />
                ))}
                <div ref={endOfMessages} />
              </div>

              {/* Shared Document Overlay */}
              {showDocument && (
                <div className="absolute inset-0 bg-white z-10 p-4 shared-notes-overlay">
                  <DocumentEditor socket={socket} peerId={activeFriend.id} onClose={() => setShowDocument(false)} />
                </div>
              )}

              {/* Message Composer */}
              <form className="p-3 bg-white border-t border-slate-200 flex flex-col gap-2 shrink-0" onSubmit={sendMessage}>
                <div className="flex items-center gap-2">
                  <textarea
                    ref={draftInput}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form.requestSubmit();
                      }
                    }}
                    placeholder="Write a message..."
                    maxLength={4000}
                    rows={1}
                    className="message-composer-input"
                  />
                  <button
                    type="button"
                    className={`message-options-toggle ${showMessageOptions ? 'is-open' : ''}`}
                    onClick={() => setShowMessageOptions((isOpen) => !isOpen)}
                    aria-expanded={showMessageOptions}
                    aria-label="Message timing and deletion settings"
                    title="Message timing and deletion settings"
                  >
                    <Clock3 size={16} />
                    <span>Options</span>
                    <ChevronDown size={14} />
                  </button>
                  <button 
                    disabled={!draft.trim() || !chatJoined}
                    className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-full transition shadow"
                  >
                    <Send size={16} />
                  </button>
                </div>

                {showMessageOptions && (
                  <div className="message-options-panel">
                    <div className="schedule-picker-field">
                      <span>Send at</span>
                      <button
                        type="button"
                        className="schedule-picker-trigger"
                        onClick={() => setShowSchedulePicker((isOpen) => !isOpen)}
                        aria-expanded={showSchedulePicker}
                      >
                        {scheduleIsSet
                          ? new Date(scheduledFor).toLocaleString()
                          : 'Choose date and time'}
                        <ChevronDown size={14} />
                      </button>
                      {showSchedulePicker && (
                        <div className="schedule-calendar" role="dialog" aria-label="Choose scheduled send date and time">
                          <div className="schedule-calendar-header">
                            <button
                              type="button"
                              aria-label="Previous month"
                              onClick={() => setScheduleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <strong>{scheduleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
                            <button
                              type="button"
                              aria-label="Next month"
                              onClick={() => setScheduleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                          <div className="schedule-calendar-grid" aria-hidden="true">
                            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                              <span key={day}>{day}</span>
                            ))}
                          </div>
                          <div className="schedule-calendar-grid">
                            {Array.from({ length: firstScheduleWeekday }, (_, index) => (
                              <span key={`empty-${index}`} />
                            ))}
                            {Array.from({ length: scheduleDaysInMonth }, (_, index) => {
                              const day = index + 1;
                              const dateKey = `${scheduleMonth.getFullYear()}-${String(scheduleMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                              const isPast = dateKey < scheduleTodayKey;
                              return (
                                <button
                                  type="button"
                                  key={dateKey}
                                  disabled={isPast}
                                  className={scheduleDate === dateKey ? 'is-selected' : ''}
                                  onClick={() => {
                                    setScheduleDate(dateKey);
                                    setScheduleIsSet(false);
                                    setScheduleError('');
                                  }}
                                >
                                  {day}
                                </button>
                              );
                            })}
                          </div>
                          <label className="schedule-calendar-time">
                            <span>Time</span>
                            <input
                              type="time"
                              value={scheduleTime}
                              onChange={(event) => {
                                setScheduleTime(event.target.value);
                                setScheduleIsSet(false);
                                setScheduleError('');
                              }}
                            />
                          </label>
                          {scheduleError && <p className="schedule-error">{scheduleError}</p>}
                          <button
                            type="button"
                            className="schedule-set-button"
                            onClick={setScheduledMessageTime}
                          >
                            Set
                          </button>
                        </div>
                      )}
                      <span className={`schedule-status ${scheduleIsSet ? 'is-set' : ''}`} role="status">
                        {scheduleIsSet
                          ? `Scheduled for ${new Date(scheduledFor).toLocaleString()}`
                          : 'Not set — sends now'}
                      </span>
                    </div>
                    <label>
                      <span>Delete after</span>
                      <select
                        value={ttlSeconds}
                        onChange={(event) => setTtlSeconds(event.target.value)}
                      >
                        <option value={0}>Never</option>
                        <option value={60}>1 minute</option>
                        <option value={3600}>1 hour</option>
                        <option value={86400}>1 day</option>
                        <option value="custom">Custom time…</option>
                      </select>
                    </label>
                    {ttlSeconds === 'custom' && (
                      <div className="custom-expiry-control">
                        <label>
                          <span>Delete after</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={customTtlAmount}
                            onChange={(event) => setCustomTtlAmount(event.target.value)}
                            aria-label="Custom deletion time amount"
                          />
                        </label>
                        <label>
                          <span>Unit</span>
                          <select
                            value={customTtlUnit}
                            onChange={(event) => setCustomTtlUnit(Number(event.target.value))}
                            aria-label="Custom deletion time unit"
                          >
                            <option value={1}>Seconds</option>
                            <option value={60}>Minutes</option>
                            <option value={3600}>Hours</option>
                            <option value={86400}>Days</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                )}
                {error && <p className="text-xs text-red-500 px-1">{error}</p>}
              </form>
            </div>
          ) : (
            /* Friends / Recent Conversations List */
            <div className="active-chats-list">
              {showChatListSearch && (
                <label className="search-field">
                  <Search size={17} aria-hidden="true" />
                  <input
                    type="search"
                    value={chatListSearch}
                    onChange={(event) => setChatListSearch(event.target.value)}
                    placeholder="Search usernames or message text"
                    aria-label="Search usernames or message text in chats"
                    autoFocus
                  />
                </label>
              )}
              <div className="divide-y divide-slate-100">
              {friends.length === 0 ? (
                <div className="text-center p-8 text-slate-400">
                  <Users size={36} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No friends added yet.</p>
                  <button 
                    onClick={() => setActiveTab('friends')} 
                    className="mt-3 text-xs text-indigo-600 font-semibold underline"
                  >
                    Add a friend to start chatting
                  </button>
                </div>
              ) : filteredChatFriends.length === 0 && chatMessageResults.length === 0 && !chatSearchLoading ? (
                <p className="search-empty">No chats match “{chatListSearch}”.</p>
              ) : (
                filteredChatFriends.map((friend) => {
                  const hasUnread = friend.unreadCount > 0;
                  return (
                    <button
                      key={friend.id}
                      onClick={() => openChat(friend)}
                      className="active-chat-row"
                    >
                      <div className="active-chat-avatar-wrap">
                        <div className="active-chat-avatar">
                          {friend.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="active-chat-presence" aria-label="Online" />
                      </div>

                      <div className="active-chat-copy">
                        <div className="active-chat-heading">
                          {/* Bold display name if unread */}
                          <h4 className={hasUnread ? 'has-unread' : ''}>
                            {friend.displayName}
                          </h4>
                          {friend.lastMessageTime && (
                            <span className="active-chat-time">
                              {new Date(friend.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        {/* Bold message preview text if unread */}
                        <p className={hasUnread ? 'has-unread' : ''}>
                          {friend.lastMessage || 'Tap to start conversation'}
                        </p>
                      </div>

                      {/* Black number inside green unread counter badge */}
                      {hasUnread && (
                        <span className="active-chat-unread">
                          {friend.unreadCount > 99 ? '99+' : friend.unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
              {chatListSearch.trim().length >= 2 && (
                <section className="chat-search-results">
                  <h3>Messages matching “{chatListSearch.trim()}”</h3>
                  {chatSearchLoading && <p className="search-empty">Searching messages…</p>}
                  {chatSearchError && <p className="search-error">{chatSearchError}</p>}
                  {!chatSearchLoading && !chatSearchError && chatMessageResults.length === 0 && (
                    <p className="search-empty">No matching messages found.</p>
                  )}
                  {chatMessageResults.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      className="chat-search-result"
                      onClick={() => openChat(
                        { id: result.peerId, displayName: result.peerName },
                        result,
                      )}
                    >
                      <span className="chat-search-result-heading">
                        <strong>{result.peerName}</strong>
                        <time>{new Date(result.createdAt).toLocaleString()}</time>
                      </span>
                      <span className="chat-search-result-text">{result.content}</span>
                    </button>
                  ))}
                </section>
              )}
              </div>
            </div>
          )
        )}

        {/* 2. FRIENDS & REQUESTS TAB */}
        {activeTab === 'friends' && (
          <div className="friends-page">
            <section className="add-friend-intro" aria-labelledby="add-friend-heading">
              <div className="add-friend-art" aria-hidden="true">
                <span className="friend-art-person friend-art-person-one"><UserRound size={23} /></span>
                <span className="friend-art-person friend-art-person-two"><UserRound size={27} /></span>
                <span className="friend-art-person friend-art-person-three"><UserRound size={21} /></span>
                <span className="friend-art-person friend-art-person-four"><UserRound size={25} /></span>
                <span className="friend-art-person friend-art-person-five"><UserRound size={20} /></span>
                <span className="friend-art-person friend-art-person-six"><UserRound size={23} /></span>
                <span className="friend-art-chat"><MessageCircle size={16} /></span>
                <span className="friend-art-plus"><UserPlus size={19} /></span>
              </div>
              <h2 id="add-friend-heading">Add Friend</h2>
              <p>Connect with friends using their ID code.</p>
            </section>

            <div className="add-friend-form-card">
              <FriendRequest onSubmit={handleFriendRequest} />
            </div>

            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={friendsSearch}
                onChange={(event) => setFriendsSearch(event.target.value)}
                placeholder="Search friends and requests"
                aria-label="Search friends and requests"
              />
            </label>
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Friends ({filteredFriends.length})
              </h3>
              {filteredFriends.map((friend) => (
                  <div key={friend.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                    <span className="font-medium text-sm text-slate-800">{friend.displayName}</span>
                    <button
                      type="button"
                      onClick={() => handleUnfriend(friend)}
                      disabled={unfriendingId === friend.id}
                      className="request-reject-button"
                    >
                      {unfriendingId === friend.id ? 'Removing…' : 'Unfriend'}
                    </button>
                  </div>
                ))}
              {friends.length === 0 && <p className="search-empty">You have no friends yet.</p>}
              {friends.length > 0 && filteredFriends.length === 0 && (
                <p className="search-empty">No friends match your search.</p>
              )}
            </div>

            {filteredRequests.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Pending Requests ({filteredRequests.length})
                </h3>
                {filteredRequests.map((request) => (
                  <div key={request.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                    <span className="font-medium text-sm text-slate-800">{request.user.displayName}</span>
                    <div className="request-actions">
                      <button
                        type="button"
                        onClick={() => handleAccept(request.id)}
                        className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(request.id)}
                        className="request-reject-button"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Sent Invitations ({filteredSentRequests.length})
              </h3>
              {filteredSentRequests.length > 0 ? (
                filteredSentRequests.map((request) => (
                  <div key={request.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                    <span className="font-medium text-sm text-slate-800">{request.user.displayName}</span>
                    <span className="invitation-pending">Pending</span>
                  </div>
                ))
              ) : (
                <p className="search-empty">
                  {sentRequests.some((request) => request.status === 'pending')
                    ? 'No pending invitations match your search.'
                    : 'No pending invitations.'}
                </p>
              )}
            </div>

          </div>
        )}

        {/* 3. NOTIFICATIONS TAB */}
        {activeTab === 'notifications' && (
          <div className="notifications-screen">
            <div className="flex items-center justify-between mb-2">
              <span className="notifications-status">
                {unreadNotifications ? `${unreadNotifications} Unread` : 'All caught up'}
              </span>
              {unreadNotifications > 0 && (
                <button 
                  onClick={() => setNotifications((current) => current.map((item) => ({ ...item, read: true })))}
                  className="text-xs text-indigo-600 font-semibold"
                >
                  Mark all read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Bell size={36} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div 
                  key={notification.id} 
                  onClick={() => openNotification(notification)}
                  className={`notification-entry ${notification.read ? '' : 'notification-entry-unread'}`}
                >
                  <div className="flex items-center space-x-3">
                    <span className="notification-entry-icon">
                      {notification.kind === 'friend-request'
                        ? <Users size={18} />
                        : notification.kind === 'friend-request-status'
                          ? notification.status === 'accepted' ? <Check size={18} /> : <X size={18} />
                          : <MessageCircle size={18} />}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{notification.title}</p>
                      <p className="text-[10px] text-slate-400">{new Date(notification.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  {notification.kind === 'friend-request' && (
                    <div className="request-actions">
                      <button
                        type="button"
                        aria-label="Accept friend request"
                        onClick={(e) => { e.stopPropagation(); handleAccept(notification.requestId); }}
                        className="p-1 bg-indigo-600 text-white rounded-lg"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="Reject friend request"
                        onClick={(e) => { e.stopPropagation(); handleReject(notification.requestId); }}
                        className="request-reject-icon"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 4. SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="settings-screen">
            <h2 className="settings-page-title">Settings</h2>
            <div className="settings-gear-art" aria-hidden="true">
              <Settings className="settings-gear settings-gear-large" />
              <Settings className="settings-gear settings-gear-medium" />
              <Settings className="settings-gear settings-gear-small" />
            </div>

            <section className="settings-options" aria-labelledby="settings-account-title">
              <h3 id="settings-account-title">Settings</h3>
              <div className="settings-row">
                <UserRound size={19} />
                <span>Account</span>
                <ChevronRight size={18} />
              </div>
              <div className="settings-row">
                <LockKeyhole size={19} />
                <span>Privacy</span>
                <ChevronRight size={18} />
              </div>
              <div className="settings-row">
                <Globe2 size={19} />
                <span>Language</span>
                <strong>{session.user.language || 'EN'}</strong>
              </div>
            </section>

            <div className="settings-signout">
              <button 
                type="button"
                onClick={signOut}
                className="settings-signout-button"
              >
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}

      </main>

      {/* WHATSAPP-STYLE BOTTOM NAVIGATION BAR */}
      <nav className="h-16 bg-white border-t border-slate-200 flex items-center justify-around shrink-0">
        <button 
          onClick={() => { setActiveTab('chats'); setActiveFriend(null); }}
          className={`flex flex-col items-center justify-center w-full h-full transition ${activeTab === 'chats' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <MessageCircle size={20} />
          <span className="text-[10px] font-medium mt-1">Chats</span>
        </button>

        <button 
          onClick={() => setActiveTab('friends')}
          className={`flex flex-col items-center justify-center w-full h-full transition relative ${activeTab === 'friends' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <UserPlus size={20} />
          <span className="text-[10px] font-medium mt-1">Friends</span>
          {requests.length > 0 && (
            <span className="absolute top-2 right-6 w-2 h-2 bg-indigo-600 rounded-full"></span>
          )}
        </button>

        <button 
          onClick={() => setActiveTab('notifications')}
          className={`flex flex-col items-center justify-center w-full h-full transition relative ${activeTab === 'notifications' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <Bell size={20} />
          <span className="text-[10px] font-medium mt-1">Updates</span>
          {unreadNotifications > 0 && (
            <span className="absolute top-2 right-6 w-2.5 h-2.5 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold"></span>
          )}
        </button>

        <button 
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center w-full h-full transition ${activeTab === 'settings' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <Settings size={20} />
          <span className="text-[10px] font-medium mt-1">Settings</span>
        </button>
      </nav>

    </div>
  );
}