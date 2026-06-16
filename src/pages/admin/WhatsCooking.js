// WhatsCooking.js — admin page to post "What's Cooking" updates to the India 101 portal.
// Uploads a flyer, has the portal's AI read it and draft a post, then publishes.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { ENDPOINTS } from '../../config/endpoints';

// India 101 portal API (see config/endpoints.js; switch to india101.com at DNS cutover).
const PORTAL_API = ENDPOINTS.portalApi;

async function authHeaders() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export default function WhatsCooking() {
  const [posts, setPosts] = useState([]);
  const [draft, setDraft] = useState(null);
  const [hint, setHint] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const loadPosts = useCallback(async () => {
    try {
      const res = await fetch(`${PORTAL_API}/api/posts?scope=admin`, { headers: await authHeaders() }).then((r) => r.json());
      if (res.posts) setPosts(res.posts);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus('Uploading flyer…');
    try {
      const h = await authHeaders();
      const up = await fetch(`${PORTAL_API}/api/posts/upload-url`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ contentType: file.type || 'image/jpeg' }),
      }).then((r) => r.json());
      if (!up.uploadUrl) throw new Error(up.error || 'upload failed');
      await fetch(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file });

      setStatus('Reading the flyer with AI…');
      const d = await fetch(`${PORTAL_API}/api/posts/draft`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ imageKey: up.key, imageFormat: up.format, hint }),
      }).then((r) => r.json());

      setDraft({
        title: d.draft?.title ?? '',
        body: d.draft?.body ?? '',
        eventDate: d.draft?.eventDate ?? '',
        imageKey: up.key,
        imageUrl: up.url,
      });
      setStatus(d.draft ? 'Draft ready — review & publish.' : d.error || "Couldn't auto-read it — type the post in.");
    } catch {
      setStatus('Something went wrong uploading. Please try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function publish(featured) {
    if (!draft) return;
    if (!draft.title.trim() || !draft.body.trim()) {
      setStatus('Add a title and a short description first.');
      return;
    }
    setBusy(true);
    setStatus('Publishing…');
    try {
      const res = await fetch(`${PORTAL_API}/api/posts`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          title: draft.title,
          body: draft.body,
          eventDate: draft.eventDate || undefined,
          imageKey: draft.imageKey,
          featured,
          published: true,
        }),
      }).then((r) => r.json());
      if (res.post) {
        setStatus('Published! ✓');
        setDraft(null);
        setHint('');
        loadPosts();
      } else {
        setStatus(res.error || 'Publish failed.');
      }
    } catch {
      setStatus('Publish failed.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(id, fields) {
    await fetch(`${PORTAL_API}/api/posts/${id}`, { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(fields) });
    loadPosts();
  }
  async function remove(id) {
    if (!window.confirm('Delete this post?')) return;
    await fetch(`${PORTAL_API}/api/posts/${id}`, { method: 'DELETE', headers: await authHeaders() });
    loadPosts();
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Uploader */}
      <div className="ui-card">
        <h2 className="text-lg font-semibold text-brand">Post an update</h2>
        <p className="text-sm text-neutral-400 mt-1">
          Upload a flyer — the assistant reads it and drafts the post for you. Review, edit if needed, then publish to the website.
        </p>
        <textarea
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          rows={2}
          placeholder="Optional note for the assistant (e.g. 'Diwali dinner — reservations recommended')"
          className="ui-input mt-3"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            disabled={busy}
            className="block text-sm text-neutral-300 file:mr-3 file:rounded-lg file:border file:border-[color:var(--line)] file:bg-transparent file:px-4 file:py-2 file:text-sm file:font-medium file:text-neutral-200 hover:file:bg-[color:var(--surface-2)] hover:file:text-white file:transition-colors"
          />
          {status && <span className="text-sm text-neutral-400">{status}</span>}
        </div>
      </div>

      {/* Draft editor */}
      {draft && (
        <div className="ui-card">
          <h3 className="font-semibold text-white mb-3">Review draft</h3>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <img src={draft.imageUrl} alt="flyer" className="h-40 w-full rounded-lg object-cover" />
            <div className="space-y-2">
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title" className="ui-input font-medium" />
              <input value={draft.eventDate} onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })} placeholder="Date / time (optional)" className="ui-input" />
              <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} placeholder="Description" className="ui-input" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => publish(true)} disabled={busy} className="ui-btn-primary">
              Publish + feature on home banner
            </button>
            <button onClick={() => publish(false)} disabled={busy} className="ui-btn-outline">
              Publish only
            </button>
            <button onClick={() => { setDraft(null); setStatus(''); }} disabled={busy} className="ui-btn-ghost">
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Existing posts */}
      <div>
        <h3 className="text-white font-semibold mb-2">Posts ({posts.length})</h3>
        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className="ui-card flex items-center gap-3 p-3">
              {p.imageUrl && <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white flex items-center gap-1.5">
                  {p.title}
                  {p.featured && <span className="ui-badge-brand">BANNER</span>}
                  {!p.published && <span className="ui-badge-muted">DRAFT</span>}
                </p>
                <p className="truncate text-xs text-neutral-500">{p.eventDate || new Date(p.createdAt).toLocaleDateString()}</p>
              </div>
              <button onClick={() => patch(p.id, { featured: !p.featured })} className="ui-btn-outline ui-btn-sm">
                {p.featured ? 'Unfeature' : 'Feature'}
              </button>
              <button onClick={() => patch(p.id, { published: !p.published })} className="ui-btn-outline ui-btn-sm">
                {p.published ? 'Unpublish' : 'Publish'}
              </button>
              <button onClick={() => remove(p.id)} className="ui-btn-danger ui-btn-sm">
                Delete
              </button>
            </div>
          ))}
          {posts.length === 0 && <p className="text-sm text-neutral-500">No posts yet.</p>}
        </div>
      </div>
    </div>
  );
}
