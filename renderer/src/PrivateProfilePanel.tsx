import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface PrivateProfileRecord {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
  updatedAt?: string;
}

interface LoginSecretRecord {
  id: string;
  label: string;
  domain: string;
  url?: string;
  username: string;
  passwordConfigured: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LoginSecretDraft {
  id?: string;
  label: string;
  domain: string;
  url: string;
  username: string;
  password: string;
  notes: string;
}

const EMPTY_PROFILE: PrivateProfileRecord = {
  fullName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  company: '',
  title: '',
  website: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  notes: '',
};

const EMPTY_SECRET: LoginSecretDraft = {
  label: '',
  domain: '',
  url: '',
  username: '',
  password: '',
  notes: '',
};

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDateLabel(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export default function PrivateProfilePanel(): React.ReactElement {
  const nexus = window.nexus;
  const [profile, setProfile] = useState<PrivateProfileRecord>(EMPTY_PROFILE);
  const [loginSecrets, setLoginSecrets] = useState<LoginSecretRecord[]>([]);
  const [secretDraft, setSecretDraft] = useState<LoginSecretDraft>(EMPTY_SECRET);
  const [profileAvailability, setProfileAvailability] = useState<{ available: boolean; backend?: string; message: string } | null>(null);
  const [vaultAvailability, setVaultAvailability] = useState<{ available: boolean; backend?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [autofillSubmit, setAutofillSubmit] = useState(false);
  const [loginAutoSubmit, setLoginAutoSubmit] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [vaultMessage, setVaultMessage] = useState('');
  const [automationMessage, setAutomationMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const refreshState = useCallback(async () => {
    const [nextProfileAvailability, nextProfile, nextVaultAvailability, nextSecrets] = await Promise.all([
      nexus.privateProfile.getAvailability(),
      nexus.privateProfile.get(),
      nexus.secretVault.getAvailability(),
      nexus.secretVault.list(),
    ]);
    setProfileAvailability(nextProfileAvailability || null);
    setProfile({ ...EMPTY_PROFILE, ...(nextProfile || {}) });
    setVaultAvailability(nextVaultAvailability || null);
    setLoginSecrets(Array.isArray(nextSecrets) ? nextSecrets : []);
  }, [nexus.privateProfile, nexus.secretVault]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setErrorMessage('');

    void refreshState()
      .catch((error) => {
        if (!disposed) {
          setErrorMessage(safeMessage(error, 'Failed to load secure profile state.'));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [refreshState]);

  const filledProfileFieldCount = useMemo(
    () => Object.values(profile).filter((value) => String(value || '').trim().length > 0).length,
    [profile],
  );

  const handleProfileChange = useCallback((key: keyof PrivateProfileRecord, value: string) => {
    setProfile((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  const handleSecretChange = useCallback((key: keyof LoginSecretDraft, value: string) => {
    setSecretDraft((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  const handleSaveProfile = useCallback(async () => {
    setProfileBusy(true);
    setErrorMessage('');
    setProfileMessage('');
    try {
      const saved = await nexus.privateProfile.save(profile);
      setProfile({ ...EMPTY_PROFILE, ...(saved || {}) });
      setProfileMessage('Encrypted private profile saved.');
    } catch (error) {
      setErrorMessage(safeMessage(error, 'Failed to save the private profile.'));
    } finally {
      setProfileBusy(false);
    }
  }, [nexus.privateProfile, profile]);

  const handleClearProfile = useCallback(async () => {
    setProfileBusy(true);
    setErrorMessage('');
    setProfileMessage('');
    try {
      await nexus.privateProfile.clear();
      setProfile(EMPTY_PROFILE);
      setProfileMessage('Private profile cleared.');
    } catch (error) {
      setErrorMessage(safeMessage(error, 'Failed to clear the private profile.'));
    } finally {
      setProfileBusy(false);
    }
  }, [nexus.privateProfile]);

  const handleSaveSecret = useCallback(async () => {
    setVaultBusy(true);
    setErrorMessage('');
    setVaultMessage('');
    try {
      await nexus.secretVault.save(secretDraft);
      await refreshState();
      setSecretDraft(EMPTY_SECRET);
      setVaultMessage('Encrypted login secret saved.');
    } catch (error) {
      setErrorMessage(safeMessage(error, 'Failed to save the login secret.'));
    } finally {
      setVaultBusy(false);
    }
  }, [nexus.secretVault, refreshState, secretDraft]);

  const handleDeleteSecret = useCallback(async (id: string) => {
    setVaultBusy(true);
    setErrorMessage('');
    setVaultMessage('');
    try {
      await nexus.secretVault.delete(id);
      await refreshState();
      if (secretDraft.id === id) {
        setSecretDraft(EMPTY_SECRET);
      }
      setVaultMessage('Login secret deleted.');
    } catch (error) {
      setErrorMessage(safeMessage(error, 'Failed to delete the login secret.'));
    } finally {
      setVaultBusy(false);
    }
  }, [nexus.secretVault, refreshState, secretDraft.id]);

  const handleFillProfile = useCallback(async () => {
    setAutomationBusy(true);
    setErrorMessage('');
    setAutomationMessage('');
    try {
      const response = await nexus.tools.execute('browser_fill_private_profile', {
        submit: autofillSubmit,
      });
      if (!response?.success) {
        throw new Error(String(response?.error || 'Profile autofill failed.'));
      }
      setAutomationMessage(String(response?.result?.message || 'Filled the active browser form from the encrypted profile.'));
    } catch (error) {
      setErrorMessage(safeMessage(error, 'Profile autofill failed.'));
    } finally {
      setAutomationBusy(false);
    }
  }, [autofillSubmit, nexus.tools]);

  const handleLoginWithSecret = useCallback(async (secret: LoginSecretRecord) => {
    setAutomationBusy(true);
    setErrorMessage('');
    setAutomationMessage('');
    try {
      const response = await nexus.tools.execute('browser_login_with_secret', {
        id: secret.id,
        url: secret.url || undefined,
        submit: loginAutoSubmit,
      });
      if (!response?.success) {
        throw new Error(String(response?.error || 'Browser login failed.'));
      }
      setAutomationMessage(String(response?.result?.message || `Filled login credentials for ${secret.label}.`));
    } catch (error) {
      setErrorMessage(safeMessage(error, 'Browser login failed.'));
    } finally {
      setAutomationBusy(false);
    }
  }, [loginAutoSubmit, nexus.tools]);

  if (loading) {
    return <div className="next-empty-inline">Loading secure profile tools…</div>;
  }

  return (
    <div className="next-stage-scroll">
      <div className="next-panel-stage">
        <div className="next-panel-stage-top">
          <div className="next-mini-panel">
            <div className="next-mini-label">Encryption</div>
            <div className="next-status-chip-row">
              <span className={`next-marketing-chip${profileAvailability?.available ? ' is-ready' : ' is-warn'}`}>
                {profileAvailability?.available ? 'Profile encryption ready' : 'Profile encryption unavailable'}
              </span>
              <span className={`next-marketing-chip${vaultAvailability?.available ? ' is-ready' : ' is-warn'}`}>
                {vaultAvailability?.available ? 'Vault ready' : 'Vault unavailable'}
              </span>
              {(profileAvailability?.backend || vaultAvailability?.backend) ? (
                <span className="next-marketing-chip">{profileAvailability?.backend || vaultAvailability?.backend}</span>
              ) : null}
            </div>
            <p className="next-panel-copy">
              The private profile stores identity and contact information for form fill. The login vault stores credentials separately so passwords never come back into chat.
            </p>
            <ul className="next-simple-list">
              <li>Filled profile fields: {filledProfileFieldCount}</li>
              <li>Saved login secrets: {loginSecrets.length}</li>
              <li>Profile updated: {formatDateLabel(profile.updatedAt)}</li>
            </ul>
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Browser Actions</div>
            <p className="next-panel-copy">
              Use the active Playwright browser page as the target. Nexus will try to match real form fields by name, label, and placeholder.
            </p>
            <label className="next-inline-check">
              <input
                type="checkbox"
                checked={autofillSubmit}
                onChange={(event) => setAutofillSubmit(event.target.checked)}
              />
              <span>Auto-submit filled profile forms when a submit button is found.</span>
            </label>
            <label className="next-inline-check">
              <input
                type="checkbox"
                checked={loginAutoSubmit}
                onChange={(event) => setLoginAutoSubmit(event.target.checked)}
              />
              <span>Auto-submit login forms after injecting saved credentials.</span>
            </label>
            <div className="next-inline-actions">
              <button
                type="button"
                className="next-primary-button"
                disabled={automationBusy}
                onClick={() => void handleFillProfile()}
              >
                {automationBusy ? 'Working…' : 'Fill Active Form'}
              </button>
            </div>
            {automationMessage ? <div className="next-success-copy">{automationMessage}</div> : null}
          </div>
        </div>

        <div className="next-profile-grid">
          <div className="next-mini-panel">
            <div className="next-mini-label">Private Profile</div>
            <div className="next-form-grid">
              <label className="next-field-group">
                <span>Full Name</span>
                <input value={profile.fullName || ''} onChange={(event) => handleProfileChange('fullName', event.target.value)} placeholder="Colby Black" />
              </label>
              <label className="next-field-group">
                <span>First Name</span>
                <input value={profile.firstName || ''} onChange={(event) => handleProfileChange('firstName', event.target.value)} placeholder="Colby" />
              </label>
              <label className="next-field-group">
                <span>Last Name</span>
                <input value={profile.lastName || ''} onChange={(event) => handleProfileChange('lastName', event.target.value)} placeholder="Black" />
              </label>
              <label className="next-field-group">
                <span>Email</span>
                <input value={profile.email || ''} onChange={(event) => handleProfileChange('email', event.target.value)} placeholder="name@company.com" />
              </label>
              <label className="next-field-group">
                <span>Phone</span>
                <input value={profile.phone || ''} onChange={(event) => handleProfileChange('phone', event.target.value)} placeholder="(555) 555-5555" />
              </label>
              <label className="next-field-group">
                <span>Company</span>
                <input value={profile.company || ''} onChange={(event) => handleProfileChange('company', event.target.value)} placeholder="Emergent Intelligence Group" />
              </label>
              <label className="next-field-group">
                <span>Title</span>
                <input value={profile.title || ''} onChange={(event) => handleProfileChange('title', event.target.value)} placeholder="Founder" />
              </label>
              <label className="next-field-group">
                <span>Website</span>
                <input value={profile.website || ''} onChange={(event) => handleProfileChange('website', event.target.value)} placeholder="https://example.com" />
              </label>
              <label className="next-field-group next-field-group--full">
                <span>Address Line 1</span>
                <input value={profile.addressLine1 || ''} onChange={(event) => handleProfileChange('addressLine1', event.target.value)} placeholder="123 Main St" />
              </label>
              <label className="next-field-group next-field-group--full">
                <span>Address Line 2</span>
                <input value={profile.addressLine2 || ''} onChange={(event) => handleProfileChange('addressLine2', event.target.value)} placeholder="Suite 200" />
              </label>
              <label className="next-field-group">
                <span>City</span>
                <input value={profile.city || ''} onChange={(event) => handleProfileChange('city', event.target.value)} placeholder="Dallas" />
              </label>
              <label className="next-field-group">
                <span>State</span>
                <input value={profile.state || ''} onChange={(event) => handleProfileChange('state', event.target.value)} placeholder="Texas" />
              </label>
              <label className="next-field-group">
                <span>Postal Code</span>
                <input value={profile.postalCode || ''} onChange={(event) => handleProfileChange('postalCode', event.target.value)} placeholder="75201" />
              </label>
              <label className="next-field-group">
                <span>Country</span>
                <input value={profile.country || ''} onChange={(event) => handleProfileChange('country', event.target.value)} placeholder="United States" />
              </label>
              <label className="next-field-group next-field-group--full">
                <span>Notes</span>
                <textarea
                  className="next-composer next-composer--compact"
                  rows={4}
                  value={profile.notes || ''}
                  onChange={(event) => handleProfileChange('notes', event.target.value)}
                  placeholder="Optional signing title, alternate contact instructions, or data you want reused in forms."
                />
              </label>
            </div>
            <div className="next-inline-actions">
              <button
                type="button"
                className="next-primary-button"
                disabled={profileBusy}
                onClick={() => void handleSaveProfile()}
              >
                {profileBusy ? 'Saving…' : 'Save Encrypted Profile'}
              </button>
              <button
                type="button"
                className="next-secondary-button"
                disabled={profileBusy}
                onClick={() => void handleClearProfile()}
              >
                Clear Profile
              </button>
            </div>
            {profileMessage ? <div className="next-success-copy">{profileMessage}</div> : null}
          </div>

          <div className="next-mini-panel">
            <div className="next-mini-label">Login Vault</div>
            <div className="next-form-grid">
              <label className="next-field-group">
                <span>Label</span>
                <input value={secretDraft.label} onChange={(event) => handleSecretChange('label', event.target.value)} placeholder="HubSpot production" />
              </label>
              <label className="next-field-group">
                <span>Domain</span>
                <input value={secretDraft.domain} onChange={(event) => handleSecretChange('domain', event.target.value)} placeholder="app.hubspot.com" />
              </label>
              <label className="next-field-group next-field-group--full">
                <span>Login URL</span>
                <input value={secretDraft.url} onChange={(event) => handleSecretChange('url', event.target.value)} placeholder="https://app.hubspot.com/login" />
              </label>
              <label className="next-field-group">
                <span>Username / Email</span>
                <input value={secretDraft.username} onChange={(event) => handleSecretChange('username', event.target.value)} placeholder="login@example.com" />
              </label>
              <label className="next-field-group">
                <span>Password</span>
                <input type="password" value={secretDraft.password} onChange={(event) => handleSecretChange('password', event.target.value)} placeholder={secretDraft.id ? 'Leave blank to keep existing password' : 'Required'} />
              </label>
              <label className="next-field-group next-field-group--full">
                <span>Notes</span>
                <textarea
                  className="next-composer"
                  rows={3}
                  value={secretDraft.notes}
                  onChange={(event) => handleSecretChange('notes', event.target.value)}
                  placeholder="Optional context, MFA note, or environment info."
                />
              </label>
            </div>
            <div className="next-inline-actions">
              <button
                type="button"
                className="next-primary-button"
                disabled={vaultBusy}
                onClick={() => void handleSaveSecret()}
              >
                {vaultBusy ? 'Saving…' : (secretDraft.id ? 'Update Secret' : 'Save Secret')}
              </button>
              <button
                type="button"
                className="next-secondary-button"
                disabled={vaultBusy}
                onClick={() => setSecretDraft(EMPTY_SECRET)}
              >
                Clear Draft
              </button>
            </div>
            {vaultMessage ? <div className="next-success-copy">{vaultMessage}</div> : null}

            <div className="next-secret-list">
              {loginSecrets.length > 0 ? loginSecrets.map((secret) => (
                <article key={secret.id} className="next-secret-row">
                  <div>
                    <strong>{secret.label}</strong>
                    <p>{secret.domain}{secret.url ? ` · ${secret.url}` : ''}</p>
                    <p>{secret.username}{secret.updatedAt ? ` · ${formatDateLabel(secret.updatedAt)}` : ''}</p>
                  </div>
                  <div className="next-inline-actions">
                    <button
                      type="button"
                      className="next-card-action"
                      disabled={automationBusy}
                      onClick={() => void handleLoginWithSecret(secret)}
                    >
                      Use Now
                    </button>
                    <button
                      type="button"
                      className="next-card-action"
                      onClick={() => setSecretDraft({
                        id: secret.id,
                        label: secret.label,
                        domain: secret.domain,
                        url: secret.url || '',
                        username: secret.username,
                        password: '',
                        notes: secret.notes || '',
                      })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="next-card-action"
                      disabled={vaultBusy}
                      onClick={() => void handleDeleteSecret(secret.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              )) : (
                <div className="next-empty-inline">
                  No encrypted login secrets yet. Save one here, then use it to fill the active browser login form.
                </div>
              )}
            </div>
          </div>
        </div>

        {errorMessage ? <div className="next-error-copy">{errorMessage}</div> : null}
      </div>
    </div>
  );
}
