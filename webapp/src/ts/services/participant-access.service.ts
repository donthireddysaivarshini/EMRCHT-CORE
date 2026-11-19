import { Injectable } from '@angular/core';
import { AuthService } from '@mm-services/auth.service';
import { UserContactService } from '@mm-services/user-contact.service';
import { ContactTypesService } from '@mm-services/contact-types.service';
import { DbService } from '@mm-services/db.service';
import { SettingsService } from '@mm-services/settings.service';

export type ParticipantAccessReason =
  | 'supervisor'
  | 'own'
  | 'other_user'
  | 'legacy'
  | 'not_participant'
  | 'unauthenticated'
  | 'expired'
  | 'invalid_timestamp'
  | 'exact_search_unlocked';

export interface ParticipantAccessResult {
  allowed: boolean;
  reason: ParticipantAccessReason;
}

export interface ParticipantAccessOptions {
  mode?: 'normal' | 'list';
}

/**
 * Normalizes Indian phone numbers for exact matching.
 * Returns a 10-digit string if the input is a valid 10-digit Indian number
 * (accepting raw 10 digits, +91/91 prefix with 12 digits, or trunk 0 with 11 digits).
 * Returns null for invalid or partial numbers (e.g. 9 digits, extra digits).
 */
export const normalizeIndianPhoneNumber = (rawPhone: any): string | null => {
  if (rawPhone === null || rawPhone === undefined) {
    return null;
  }
  const str = String(rawPhone).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return null;
};

/**
 * Normalizes participant full names for exact matching.
 * Converts to lowercase and removes all whitespace, dots, hyphens, and common punctuation.
 * Preserves the exact sequence of letters while ignoring spacing, capitalization, and punctuation variations
 * (e.g. "R. L. Narasimha Rao", "R.L. Narasimharao", and "r l narasimha rao" all evaluate identically).
 * Returns null for empty strings.
 */
export const normalizeParticipantName = (rawName: any): string | null => {
  if (rawName === null || rawName === undefined || typeof rawName !== 'string') {
    return null;
  }
  const normalized = rawName.toLowerCase().replace(/[\s.\-_',"`]/g, '');
  return normalized.length > 0 ? normalized : null;
};

/**
 * Checks exact match for CR number.
 * Normalizes by converting to lowercase and stripping whitespace, hyphens, dots, and punctuation
 * so formatting variations (e.g. "CR-001", "cr-001", "CR001", "CR 001") match reliably.
 */
export const isExactCrMatch = (docCr: any, queryCr: any): boolean => {
  if (docCr === null || docCr === undefined || queryCr === null || queryCr === undefined) {
    return false;
  }
  const clean = (val: any) => String(val).toLowerCase().replace(/[\s.\-_',"`]/g, '');
  const cleanDoc = clean(docCr);
  const cleanQuery = clean(queryCr);
  return cleanDoc.length > 0 && cleanDoc === cleanQuery;
};

@Injectable({
  providedIn: 'root'
})
export class ParticipantAccessService {
  private unlockedParticipantsByUser: Map<string, Set<string>> = new Map();

  constructor(
    private authService: AuthService,
    private userContactService: UserContactService,
    private contactTypesService: ContactTypesService,
    private dbService: DbService,
    private settingsService: SettingsService,
  ) {}

  private getSessionStorageKey(userId: string): string {
    return `cht_exact_unlocked_participants_${userId}`;
  }

  private loadUnlockedFromSession(userId: string): Set<string> {
    if (!this.unlockedParticipantsByUser.has(userId)) {
      const set = new Set<string>();
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          const raw = window.sessionStorage.getItem(this.getSessionStorageKey(userId));
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              parsed.forEach((id: string) => {
                if (typeof id === 'string' && id) {
                  set.add(id);
                }
              });
            }
          }
        }
      } catch (err) {
        console.warn('ParticipantAccessService :: Error loading session unlocks', err);
      }
      this.unlockedParticipantsByUser.set(userId, set);
    }
    return this.unlockedParticipantsByUser.get(userId)!;
  }

  private saveUnlockedToSession(userId: string, set: Set<string>): void {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const key = this.getSessionStorageKey(userId);
        if (set.size === 0) {
          window.sessionStorage.removeItem(key);
        } else {
          window.sessionStorage.setItem(key, JSON.stringify(Array.from(set)));
        }
      }
    } catch (err) {
      console.warn('ParticipantAccessService :: Error saving session unlocks', err);
    }
  }

  unlockParticipant(participantUuid: string, userId: string): void {
    if (!participantUuid || !userId) {
      return;
    }
    const set = this.loadUnlockedFromSession(userId);
    set.add(participantUuid);
    this.saveUnlockedToSession(userId, set);
  }

  isParticipantUnlocked(participantUuid: string, userId: string): boolean {
    if (!participantUuid || !userId) {
      return false;
    }
    const set = this.loadUnlockedFromSession(userId);
    return set.has(participantUuid);
  }

  clearUnlockedParticipants(userId?: string): void {
    if (userId) {
      this.unlockedParticipantsByUser.delete(userId);
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem(this.getSessionStorageKey(userId));
        }
      } catch (_err) {
        // ignore
      }
    } else {
      this.unlockedParticipantsByUser.clear();
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          const keysToRemove: string[] = [];
          for (let i = 0; i < window.sessionStorage.length; i++) {
            const k = window.sessionStorage.key(i);
            if (k && k.startsWith('cht_exact_unlocked_participants_')) {
              keysToRemove.push(k);
            }
          }
          keysToRemove.forEach(k => window.sessionStorage.removeItem(k));
        }
      } catch (_err) {
        // ignore
      }
    }
  }

  /**
   * Executes exact search against participants in the local PouchDB dataset.
   * If exact matches are found, unlocks them specifically for the current authenticated user.
   * Returns only the matched participant documents.
   */
  async searchExactParticipants(query: string, searchType: 'cr_no' | 'phone' | 'name'): Promise<any[]> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }
    const trimmedQuery = query.trim();

    // 1. Resolve current user ID
    let currentUserId: string | undefined;
    try {
      const userContact = await this.userContactService.get({ hydrateLineage: false });
      currentUserId = userContact?._id;
    } catch (err) {
      console.warn('ParticipantAccessService :: Error retrieving user contact for search', err);
      currentUserId = undefined;
    }

    // 2. Query participants from local PouchDB view medic-client/contacts_by_type
    let allParticipants: any[] = [];
    try {
      const db = this.dbService.get();
      const res = await db.query('medic-client/contacts_by_type', {
        key: ['participant'],
        include_docs: true,
        reduce: false,
      });
      allParticipants = (res.rows || []).map((r: any) => r.doc).filter((d: any) => d && !d._deleted);
    } catch (err) {
      console.warn('ParticipantAccessService :: Query on contacts_by_type failed, attempting fallback', err);
      try {
        const db = this.dbService.get();
        const res = await db.allDocs({ include_docs: true });
        allParticipants = (res.rows || [])
          .map((r: any) => r.doc)
          .filter((d: any) => d && !d._deleted && (d.contact_type === 'participant' || d.type === 'participant'));
      } catch (fallbackErr) {
        console.error('ParticipantAccessService :: Fallback allDocs query failed', fallbackErr);
        return [];
      }
    }

    // 3. Perform strict field-specific exact matching
    let matched: any[] = [];
    if (searchType === 'cr_no') {
      matched = allParticipants.filter(doc => isExactCrMatch(doc.cr_no || doc.cr_number, trimmedQuery));
    } else if (searchType === 'phone') {
      const normQueryPhone = normalizeIndianPhoneNumber(trimmedQuery);
      if (normQueryPhone) {
        matched = allParticipants.filter(doc => {
          const normDocPhone = normalizeIndianPhoneNumber(doc.phone || doc.secondary_phone);
          return normDocPhone !== null && normDocPhone === normQueryPhone;
        });
      }
    } else if (searchType === 'name') {
      const normQueryName = normalizeParticipantName(trimmedQuery);
      if (normQueryName) {
        matched = allParticipants.filter(doc => {
          const normDocName = normalizeParticipantName(doc.name);
          return normDocName !== null && normDocName === normQueryName;
        });
      }
    }

    // 4. Register matched participant UUID(s) as authorized for the current user
    if (currentUserId && matched.length > 0) {
      for (const doc of matched) {
        if (doc._id) {
          this.unlockParticipant(doc._id, currentUserId);
        }
      }
    }

    return matched;
  }

  /**
   * Evaluates whether the current user is allowed to access the provided report.
   * Supervisors are allowed access to all reports.
   * Interns can only access participant assessment reports if they are allowed access to the participant.
   * If a report is identified as a participant assessment but its participant UUID cannot be resolved,
   * access is denied for Interns.
   * Non-participant reports remain accessible.
   */
  async canAccessReport(report: any): Promise<boolean> {
    if (!report) {
      return false;
    }

    // 1. Supervisor / Global participant access bypass
    const canBrowseAll =
      (await this.authService.has('can_browse_all_participants')) ||
      (await this.authService.has('can_view_participants'));
    if (canBrowseAll) {
      return true;
    }

    let doc = report.doc || report;

    // The reports list holds summaries without `fields`; read the full report so
    // the participant can be identified (otherwise every assessment stays hidden).
    if (!doc.fields && doc._id) {
      try {
        doc = await this.dbService.get().get(doc._id);
      } catch (err) {
        console.warn('ParticipantAccessService :: Error fetching report for access check', err);
        return false;
      }
    }

    // List of known participant assessment forms
    const participantAssessmentForms = [
      'ddst',
      'dst',
      'moca_assessment',
      'moca',
      'moca_b',
      'moca_telugu',
      'vineland',
      'vineland_v2',
      'vsms',
      'cog5',
      'stage1_screening',
      'stage2_assessment',
      'assessment_visit',
      'longitudinal_review',
      'referral_outcome',
      'follow_up_contact',
    ];

    const isAssessmentForm = doc.form && participantAssessmentForms.includes(doc.form);
    const hasParticipantFields = Boolean(doc.fields?.patient_uuid || doc.fields?.inputs?.contact?._id);

    if (isAssessmentForm || hasParticipantFields) {
      // Participant UUID must ONLY be resolved via patient_uuid or inputs.contact._id
      // (Never use doc.contact._id or doc.patient_id)
      const participantUuid = doc.fields?.patient_uuid || doc.fields?.inputs?.contact?._id;
      if (!participantUuid) {
        // If the report is identified as a participant assessment but its participant UUID cannot be resolved,
        // deny access for the Intern
        return false;
      }

      try {
        const db = this.dbService.get();
        const participantDoc = await db.get(participantUuid);
        return await this.canAccess(participantDoc);
      } catch (err) {
        console.warn('ParticipantAccessService :: Error fetching participant for report', err);
        return false;
      }
    }

    // For genuinely non-participant reports, preserve existing behavior
    return true;
  }

  /**
   * Evaluates whether the current user is allowed to access the provided participant.
   * Returns true if allowed, false otherwise.
   */
  async canAccess(contact: any, options: ParticipantAccessOptions = { mode: 'normal' }): Promise<boolean> {
    const result = await this.checkAccess(contact, options);
    return result.allowed;
  }

  async getVisibilityHours(): Promise<number> {
    const DEFAULT_HOURS = 24;
    try {
      const settings = await this.settingsService.get();
      const raw = settings?.participant_visibility_hours ?? settings?.intern_participant_visibility_hours;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    } catch (err) {
      console.warn('ParticipantAccessService :: Error retrieving visibility setting', err);
    }
    return DEFAULT_HOURS;
  }

  /**
   * Evaluates participant access and returns an object containing the boolean `allowed` status
   * and a specific diagnostic `reason`.
   */
  async checkAccess(
    contact: any,
    options: ParticipantAccessOptions = { mode: 'normal' },
  ): Promise<ParticipantAccessResult> {
    if (!contact) {
      return { allowed: false, reason: 'not_participant' };
    }

    // 1. Supervisor / Global participant access bypass
    const canBrowseAll =
      (await this.authService.has('can_browse_all_participants')) ||
      (await this.authService.has('can_view_participants'));
    if (canBrowseAll) {
      return { allowed: true, reason: 'supervisor' };
    }

    // Unwrap doc if model or wrapped object was provided
    const doc = contact.doc || contact;

    // 2. Non-participant check
    const typeId = this.contactTypesService.getTypeId(doc);
    const isParticipant = typeId === 'participant' || doc.contact_type === 'participant' || doc.type === 'participant';
    if (!isParticipant) {
      return { allowed: true, reason: 'not_participant' };
    }

    // 3. Current authenticated user's person contact UUID
    let currentUserId: string | undefined;
    try {
      const userContact = await this.userContactService.get({ hydrateLineage: false });
      currentUserId = userContact?._id;
    } catch (err) {
      console.warn('ParticipantAccessService :: Error retrieving user contact', err);
      currentUserId = undefined;
    }

    if (!currentUserId) {
      return { allowed: false, reason: 'unauthenticated' };
    }

    // 4. Exact-search authorization check:
    // Only applies to non-list access (e.g. participant profile, direct route, edit, assessment forms, reports).
    // In normal list mode (options.mode === 'list'), exact-search unlocks do not cause expired or
    // other-user participants
    // to appear in the normal screening camp list.
    if (options.mode !== 'list' && doc._id && this.isParticipantUnlocked(doc._id, currentUserId)) {
      return { allowed: true, reason: 'exact_search_unlocked' };
    }

    // 5. Creator metadata check (legacy records created before Phase 1 have missing/null creator)
    if (!doc.created_by_person_uuid) {
      return { allowed: false, reason: 'legacy' };
    }

    // 6. Ownership check (must match authenticated user contact UUID)
    if (doc.created_by_person_uuid !== currentUserId) {
      return { allowed: false, reason: 'other_user' };
    }

    // 7. Visibility window check — applies to all Intern access (not just list mode).
    // The mode parameter is preserved in the interface for Phase 2 exact-search unlock;
    // no unrestricted bypass is provided here.
    const reportedDate = Number(doc.reported_date);
    if (!Number.isFinite(reportedDate) || reportedDate <= 0) {
      // Invalid or missing timestamp -> safely hidden for Intern rather than accidentally exposed
      return { allowed: false, reason: 'invalid_timestamp' };
    }

    const visibilityHours = await this.getVisibilityHours();
    const visibilityPeriodMs = visibilityHours * 60 * 60 * 1000;
    const ageMs = Date.now() - reportedDate;
    if (ageMs > visibilityPeriodMs) {
      return { allowed: false, reason: 'expired' };
    }

    return { allowed: true, reason: 'own' };
  }
}

