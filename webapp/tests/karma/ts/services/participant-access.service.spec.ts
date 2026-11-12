import { TestBed } from '@angular/core/testing';
import { expect } from 'chai';
import sinon from 'sinon';

import {
  ParticipantAccessService,
  ParticipantAccessResult,
  normalizeIndianPhoneNumber,
  normalizeParticipantName,
  isExactCrMatch
} from '@mm-services/participant-access.service';
import { AuthService } from '@mm-services/auth.service';
import { UserContactService } from '@mm-services/user-contact.service';
import { ContactTypesService } from '@mm-services/contact-types.service';
import { DbService } from '@mm-services/db.service';
import { SettingsService } from '@mm-services/settings.service';

describe('ParticipantAccessService', () => {
  let service: ParticipantAccessService;
  let authServiceStub: { has: sinon.SinonStub };
  let userContactServiceStub: { get: sinon.SinonStub };
  let contactTypesServiceStub: { getTypeId: sinon.SinonStub };
  let dbGetStub: sinon.SinonStub;
  let dbQueryStub: sinon.SinonStub;
  let dbAllDocsStub: sinon.SinonStub;
  let dbServiceStub: { get: sinon.SinonStub };
  let settingsServiceStub: { get: sinon.SinonStub };

  const BASE_TIME = 1726569600000;
  const CURRENT_USER_UUID = 'user-contact-uuid-12345';
  const OTHER_USER_UUID = 'other-user-uuid-67890';

  beforeEach(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.clear();
    }

    authServiceStub = {
      has: sinon.stub().resolves(false),
    };

    userContactServiceStub = {
      get: sinon.stub().resolves({ _id: CURRENT_USER_UUID, name: 'Varshini User', username: 'varshini' }),
    };

    contactTypesServiceStub = {
      getTypeId: sinon.stub().callsFake((doc) => doc?.contact_type || doc?.type || 'participant'),
    };

    dbGetStub = sinon.stub();
    dbQueryStub = sinon.stub().resolves({ rows: [] });
    dbAllDocsStub = sinon.stub().resolves({ rows: [] });
    dbServiceStub = {
      get: sinon.stub().returns({
        get: dbGetStub,
        query: dbQueryStub,
        allDocs: dbAllDocsStub,
      }),
    };

    settingsServiceStub = {
      get: sinon.stub().resolves({ participant_visibility_hours: 24 }),
    };

    TestBed.configureTestingModule({
      providers: [
        ParticipantAccessService,
        { provide: AuthService, useValue: authServiceStub },
        { provide: UserContactService, useValue: userContactServiceStub },
        { provide: ContactTypesService, useValue: contactTypesServiceStub },
        { provide: DbService, useValue: dbServiceStub },
        { provide: SettingsService, useValue: settingsServiceStub },
      ],
    });

    service = TestBed.inject(ParticipantAccessService);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('A. Supervisor Access', () => {
    beforeEach(() => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(true);
    });

    it('1. Supervisor + recent participant -> allowed (reason: supervisor)', async () => {
      const participant = {
        _id: 'part-1',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: BASE_TIME - (1 * 60 * 60 * 1000),
      };

      const result: ParticipantAccessResult = await service.checkAccess(participant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
      expect(await service.canAccess(participant)).to.be.true;
    });

    it('2. Supervisor + old participant -> allowed (reason: supervisor)', async () => {
      const participant = {
        _id: 'part-old',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: BASE_TIME - (480 * 60 * 60 * 1000),
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
    });

    it('3. Supervisor + legacy participant -> allowed (reason: supervisor)', async () => {
      const legacyParticipant = {
        _id: 'part-legacy',
        type: 'participant',
        created_by_person_uuid: null,
      };

      const result = await service.checkAccess(legacyParticipant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
    });

    it('4. Supervisor + another user participant -> allowed (reason: supervisor)', async () => {
      const otherParticipant = {
        _id: 'part-other',
        type: 'participant',
        created_by_person_uuid: OTHER_USER_UUID,
      };

      const result = await service.checkAccess(otherParticipant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
    });

    it('4b. Supervisor + can_view_participants (without' +
      ' can_browse_all_participants) -> allowed (reason: supervisor)', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      authServiceStub.has.withArgs('can_view_participants').resolves(true);

      const legacyParticipant = {
        _id: 'part-legacy-live',
        type: 'participant',
        created_by_person_uuid: null,
      };

      const result = await service.checkAccess(legacyParticipant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
      expect(await service.canAccessReport(
        { doc: { form: 'moca', fields: { patient_uuid: 'part-legacy-live' } } }
      )).to.be.true;
    });
  });

  describe('B. Intern / Normal Ownership Access', () => {
    it('5. Own participant -> allowed (reason: own)', async () => {
      const participant = {
        _id: 'part-recent',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: Date.now() - (1 * 60 * 60 * 1000),
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('own');
      expect(await service.canAccess(participant)).to.be.true;
    });

    it('6. Own participant created RECENTLY (within 24h) -> allowed (reason: own)', async () => {
      const participant = {
        _id: 'part-recent-own',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('own');
      expect(await service.canAccess(participant)).to.be.true;
    });

    it('6b. Own participant EXPIRED (older than 24h) -> denied (reason: expired)', async () => {
      const participant = {
        _id: 'part-old-own',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: Date.now() - (300 * 24 * 60 * 60 * 1000), // 300 days ago
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('expired');
      expect(await service.canAccess(participant)).to.be.false;
    });

    it('7. Own participant with missing/null reported_date -> denied (reason: invalid_timestamp)', async () => {
      const participant = {
        _id: 'part-no-date',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('invalid_timestamp');
    });

    it('8. Another user participant -> denied (reason: other_user)', async () => {
      const participant = {
        _id: 'part-other',
        type: 'participant',
        created_by_person_uuid: OTHER_USER_UUID,
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('other_user');
      expect(await service.canAccess(participant)).to.be.false;
    });

    it('9. Legacy participant (null created_by_person_uuid) -> denied (reason: legacy)', async () => {
      const participant = {
        _id: 'part-legacy',
        type: 'participant',
        created_by_person_uuid: null,
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('legacy');
      expect(await service.canAccess(participant)).to.be.false;
    });

    it('10. Missing creator (undefined created_by_person_uuid) -> denied (reason: legacy)', async () => {
      const participant = {
        _id: 'part-missing-creator',
        type: 'participant',
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('legacy');
    });

    it('11. Empty creator string -> denied (reason: legacy)', async () => {
      const participant = {
        _id: 'part-empty-creator',
        type: 'participant',
        created_by_person_uuid: '',
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('legacy');
    });
  });

  describe('C. User Identity & Authentication', () => {
    it('12. Verification uses userContact._id, NOT username or display name', async () => {
      userContactServiceStub.get.resolves({
        _id: CURRENT_USER_UUID,
        name: 'Varshini User',
        username: 'varshini',
      });

      const participantWithUsernameAsCreator = {
        _id: 'part-fake',
        type: 'participant',
        created_by_person_uuid: 'varshini',
      };

      const result = await service.checkAccess(participantWithUsernameAsCreator);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('other_user');
    });

    it('13. Missing user contact -> denied (reason: unauthenticated)', async () => {
      userContactServiceStub.get.resolves(null);

      const participant = {
        _id: 'part-1',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('unauthenticated');
    });

    it('14. UserContactService failure -> denied (reason: unauthenticated)', async () => {
      userContactServiceStub.get.rejects(new Error('DB unreachable'));

      const participant = {
        _id: 'part-1',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
      };

      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('unauthenticated');
    });
  });

  describe('D. Non-Participant & Wrapped Objects', () => {
    it('15. Screening camp / place / non-participant -> allowed (reason: not_participant)', async () => {
      contactTypesServiceStub.getTypeId.callsFake((doc) => doc?.type);

      const campDoc = {
        _id: 'camp-1',
        type: 'screening_camp',
        name: 'NIMS Camp 1',
      };

      const result = await service.checkAccess(campDoc);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('not_participant');
    });

    it('16. Null or empty contact -> denied (reason: not_participant)', async () => {
      const result = await service.checkAccess(null);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('not_participant');
    });

    it('17. Wrapped child/model object { doc: participant } is supported seamlessly', async () => {
      const wrappedChild = {
        id: 'part-recent',
        doc: {
          _id: 'part-recent',
          type: 'participant',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago - within window
        }
      };

      const result = await service.checkAccess(wrappedChild);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('own');
    });
  });

  describe('E. Report Access (canAccessReport)', () => {
    it('18. Supervisor can access any report', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(true);
      const report = {
        _id: 'rep-1',
        form: 'ddst',
        fields: { patient_uuid: 'any-participant' },
      };

      const allowed = await service.canAccessReport(report);
      expect(allowed).to.be.true;
    });

    it('19. Intern can access report for RECENT OWN participant (within 24h)', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      const report = {
        _id: 'rep-ddst',
        form: 'ddst',
        fields: { patient_uuid: 'part-own' },
      };
      dbGetStub.withArgs('part-own').resolves({
        _id: 'part-own',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago
      });

      const allowed = await service.canAccessReport(report);
      expect(allowed).to.be.true;
    });

    it('20. Intern can access report via inputs.contact._id for RECENT OWN participant', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      const report = {
        _id: 'rep-moca',
        form: 'moca_assessment',
        fields: { inputs: { contact: { _id: 'part-own-2' } } },
      };
      dbGetStub.withArgs('part-own-2').resolves({
        _id: 'part-own-2',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago
      });

      const allowed = await service.canAccessReport(report);
      expect(allowed).to.be.true;
    });

    it('21. Intern cannot access report if participant was created by another user', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      const report = {
        _id: 'rep-dst',
        form: 'dst',
        fields: { patient_uuid: 'part-other' },
      };
      dbGetStub.withArgs('part-other').resolves({
        _id: 'part-other',
        type: 'participant',
        created_by_person_uuid: OTHER_USER_UUID,
      });

      const allowed = await service.canAccessReport(report);
      expect(allowed).to.be.false;
    });

    it('22. Intern cannot access report if participant is legacy (null/missing creator)', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      const report = {
        _id: 'rep-vineland',
        form: 'vineland',
        fields: { patient_uuid: 'part-legacy' },
      };
      dbGetStub.withArgs('part-legacy').resolves({
        _id: 'part-legacy',
        type: 'participant',
      });

      const allowed = await service.canAccessReport(report);
      expect(allowed).to.be.false;
    });

    it('23. Intern cannot access participant assessment report when' +
      ' participant UUID is missing/unresolvable', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      const report = {
        _id: 'rep-no-subject',
        form: 'ddst',
        fields: {},
      };

      const allowed = await service.canAccessReport(report);
      expect(allowed).to.be.false;
    });

    it('24. Genuinely non-participant reports remain accessible to Interns', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      const report = {
        _id: 'rep-general',
        form: 'general_facility_inspection',
        fields: { facility_id: 'fac-1' },
      };

      const allowed = await service.canAccessReport(report);
      expect(allowed).to.be.true;
    });
  });

  describe('F. Phase 1 — Normal List Visibility Expiration', () => {
    const NOW = Date.now();
    const RECENT_REPORTED_DATE = NOW - (1 * 60 * 60 * 1000); // 1 hour ago
    const EXPIRED_REPORTED_DATE = NOW - (25 * 60 * 60 * 1000); // 25 hours ago

    beforeEach(() => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      authServiceStub.has.withArgs('can_view_participants').resolves(false);
      settingsServiceStub.get.resolves({ participant_visibility_hours: 24 });
    });

    it('1. Intern + own participant + within visibility period -> visible (allowed: true, reason: own)', async () => {
      const participant = {
        _id: 'p-own-recent',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: RECENT_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('own');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.true;
    });

    it('2. Intern + own participant + expired -> hidden (allowed: false, reason: expired)', async () => {
      const participant = {
        _id: 'p-own-expired',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: EXPIRED_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('expired');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.false;
    });

    it('3. Intern + another Intern participant -> hidden (allowed: false, reason: other_user)', async () => {
      const participant = {
        _id: 'p-other-intern',
        type: 'participant',
        created_by_person_uuid: 'another-intern-uuid',
        reported_date: RECENT_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('other_user');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.false;
    });

    it('4. Intern + Supervisor-created participant -> hidden (allowed: false, reason: other_user)', async () => {
      const participant = {
        _id: 'p-sup-created',
        type: 'participant',
        created_by_person_uuid: 'supervisor-uuid-999',
        reported_date: RECENT_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('other_user');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.false;
    });

    it('5. Intern + Admin-created participant -> hidden (allowed: false, reason: other_user)', async () => {
      const participant = {
        _id: 'p-admin-created',
        type: 'participant',
        created_by_person_uuid: 'admin-uuid-888',
        reported_date: RECENT_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('other_user');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.false;
    });

    it('6. Intern + legacy participant with no creator metadata ->' +
      ' hidden (allowed: false, reason: legacy)', async () => {
      const legacyParticipant = {
        _id: 'p-legacy-no-creator',
        type: 'participant',
        reported_date: RECENT_REPORTED_DATE,
      };

      const result = await service.checkAccess(legacyParticipant, { mode: 'list' });
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('legacy');
      expect(await service.canAccess(legacyParticipant, { mode: 'list' })).to.be.false;
    });

    it('7. Supervisor + own participant -> visible (allowed: true, reason: supervisor)', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(true);

      const participant = {
        _id: 'p-sup-own',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: RECENT_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.true;
    });

    it('8. Supervisor + another Intern participant -> visible (allowed: true, reason: supervisor)', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(true);

      const participant = {
        _id: 'p-sup-other-intern',
        type: 'participant',
        created_by_person_uuid: 'intern-B-uuid',
        reported_date: RECENT_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.true;
    });

    it('9. Supervisor + expired participant -> visible (allowed: true, reason: supervisor)', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(true);

      const participant = {
        _id: 'p-sup-expired',
        type: 'participant',
        created_by_person_uuid: 'intern-B-uuid',
        reported_date: EXPIRED_REPORTED_DATE,
      };

      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
      expect(await service.canAccess(participant, { mode: 'list' })).to.be.true;
    });

    it('10. Invalid/missing visibility setting -> safe default behavior (24 hours)', async () => {
      settingsServiceStub.get.resolves({ participant_visibility_hours: 'not-a-number' });

      // Participant at 23 hours should be visible under 24h default
      const participant23h = {
        _id: 'p-23h',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: NOW - (23 * 60 * 60 * 1000),
      };
      // Participant at 25 hours should be expired under 24h default
      const participant25h = {
        _id: 'p-25h',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: NOW - (25 * 60 * 60 * 1000),
      };

      const res23 = await service.checkAccess(participant23h, { mode: 'list' });
      expect(res23.allowed).to.be.true;
      expect(res23.reason).to.equal('own');

      const res25 = await service.checkAccess(participant25h, { mode: 'list' });
      expect(res25.allowed).to.be.false;
      expect(res25.reason).to.equal('expired');
    });

    it('11. Invalid/missing timestamp -> safely hidden for Intern rather than accidentally exposed', async () => {
      const participantNoDate = {
        _id: 'p-no-date',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: undefined,
      };

      const participantInvalidDate = {
        _id: 'p-invalid-date',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: 'not-a-date',
      };

      const resNoDate = await service.checkAccess(participantNoDate, { mode: 'list' });
      expect(resNoDate.allowed).to.be.false;
      expect(resNoDate.reason).to.equal('invalid_timestamp');

      const resInvalid = await service.checkAccess(participantInvalidDate, { mode: 'list' });
      expect(resInvalid.allowed).to.be.false;
      expect(resInvalid.reason).to.equal('invalid_timestamp');
    });

    it('12. Participant document must remain unchanged by the filtering operation', async () => {
      const originalParticipant = {
        _id: 'p-immutable-check',
        type: 'participant',
        name: 'Test Patient',
        cr_no: 'CR-100',
        phone: '9866063125',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: RECENT_REPORTED_DATE,
        extra_field: { sub_prop: 'immutable_value' },
      };

      const clone = JSON.parse(JSON.stringify(originalParticipant));

      await service.checkAccess(originalParticipant, { mode: 'list' });
      await service.canAccess(originalParticipant, { mode: 'list' });

      expect(originalParticipant).to.deep.equal(clone);
    });
  });

  // ---------------------------------------------------------------------------
  // G. Full-Surface Blocking Tests (Phase 1 Correction)
  // ---------------------------------------------------------------------------
  describe('G. Full-Surface Expiry Blocking (all access modes)', () => {
    const NOW = Date.now();
    const RECENT = NOW - (1 * 60 * 60 * 1000);   // 1 hour ago
    const EXPIRED = NOW - (25 * 60 * 60 * 1000);  // 25 hours ago

    beforeEach(() => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(false);
      authServiceStub.has.withArgs('can_view_participants').resolves(false);
      settingsServiceStub.get.resolves({ participant_visibility_hours: 24 });
    });

    // Req 1: Intern + own recent participant -> allowed
    it('G1. Intern + own recent participant (default mode) -> allowed (reason: own)', async () => {
      const participant = {
        _id: 'g1-recent', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: RECENT,
      };
      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('own');
    });

    // Req 2: Intern + own expired participant -> blocked (profile, edit, assessment, report)
    it('G2. Intern + own EXPIRED participant (default mode) -> denied (reason: expired)', async () => {
      const participant = {
        _id: 'g2-expired', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
      };
      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('expired');
    });

    // Req 3: Intern + another user's recent participant -> blocked
    it('G3. Intern + another user recent participant -> denied (reason: other_user)', async () => {
      const participant = {
        _id: 'g3-other-recent', type: 'participant',
        created_by_person_uuid: OTHER_USER_UUID, reported_date: RECENT,
      };
      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('other_user');
    });

    // Req 4: Intern + another user's expired participant -> blocked
    it('G4. Intern + another user EXPIRED participant -> denied (reason: other_user)', async () => {
      const participant = {
        _id: 'g4-other-expired', type: 'participant',
        created_by_person_uuid: OTHER_USER_UUID, reported_date: EXPIRED,
      };
      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('other_user');
    });

    // Req 5: Legacy participant -> blocked
    it('G5. Legacy participant (no creator) -> denied (reason: legacy)', async () => {
      const participant = {
        _id: 'g5-legacy', type: 'participant', reported_date: RECENT,
      };
      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('legacy');
    });

    // Req 6: Supervisor + any participant -> allowed
    it('G6. Supervisor + expired participant -> allowed (reason: supervisor)', async () => {
      authServiceStub.has.withArgs('can_browse_all_participants').resolves(true);
      const participant = {
        _id: 'g6-sup-expired', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
      };
      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('supervisor');
    });

    // Req 8: Recent participant reports remain accessible
    it('G8. Recent participant report accessible to owner (canAccessReport)', async () => {
      const report = { _id: 'r-g8', form: 'ddst', fields: { patient_uuid: 'p-g8' } };
      dbGetStub.withArgs('p-g8').resolves({
        _id: 'p-g8', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: RECENT,
      });
      expect(await service.canAccessReport(report)).to.be.true;
    });

    // Req 9: Expired participant individual report -> blocked
    it('G9. Expired participant report blocked for owner (canAccessReport)', async () => {
      const report = { _id: 'r-g9', form: 'ddst', fields: { patient_uuid: 'p-g9' } };
      dbGetStub.withArgs('p-g9').resolves({
        _id: 'p-g9', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
      });
      expect(await service.canAccessReport(report)).to.be.false;
    });

    // Req 10: Expired participant edit -> blocked (uses checkAccess default mode)
    it('G10. Expired participant edit blocked (checkAccess without mode)', async () => {
      const participant = {
        _id: 'g10-edit', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
      };
      const result = await service.checkAccess(participant);
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('expired');
    });

    // Req 11: Expired participant assessment forms -> blocked (contacts-report passes contact through checkAccess)
    it('G11. Expired participant assessment form blocked (checkAccess without mode)', async () => {
      const participant = {
        _id: 'g11-form', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
      };
      // contacts-report.component calls canAccess(contact) with no mode
      expect(await service.canAccess(participant)).to.be.false;
    });

    // Req 12: Direct participant profile access -> blocked (contacts.effects calls canAccess with no mode)
    it('G12. Expired participant profile blocked (canAccess without mode)', async () => {
      const participant = {
        _id: 'g12-profile', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
      };
      expect(await service.canAccess(participant)).to.be.false;
    });

    // Req 13: Phase 1 list tests continue to pass (mode:'list' still works)
    it('G13. mode:list still works for recent participant (backward compat)', async () => {
      const participant = {
        _id: 'g13-list-recent', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: RECENT,
      };
      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.true;
      expect(result.reason).to.equal('own');
    });

    it('G13b. mode:list still blocks expired participant (backward compat)', async () => {
      const participant = {
        _id: 'g13b-list-expired', type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
      };
      const result = await service.checkAccess(participant, { mode: 'list' });
      expect(result.allowed).to.be.false;
      expect(result.reason).to.equal('expired');
    });
  });

  describe('Phase 2: Exact Participant Search & Authorization', () => {
    const NOW = Date.now();
    const EXPIRED = NOW - (30 * 60 * 60 * 1000); // 30 hours old (> 24h)
    const RECENT = NOW - (2 * 60 * 60 * 1000);   // 2 hours old (< 24h)

    describe('Search Matching Engine & Normalization Rules', () => {
      it('1. Exact CR match: CR-001 matches CR-001, cr-001, CR001, and with spaces', () => {
        expect(isExactCrMatch('CR-001', 'CR-001')).to.be.true;
        expect(isExactCrMatch('  CR-001  ', 'CR-001')).to.be.true;
        expect(isExactCrMatch('CR-001', 'cr-001')).to.be.true;
        expect(isExactCrMatch('CR-001', 'CR001')).to.be.true;
        expect(isExactCrMatch('CR-001', 'CR 001')).to.be.true;
      });

      it('2. Partial CR rejected: CR-00 does NOT match CR-001', () => {
        expect(isExactCrMatch('CR-001', 'CR-00')).to.be.false;
      });

      it('3. Extra CR characters rejected: CR-0012 does NOT match CR-001', () => {
        expect(isExactCrMatch('CR-001', 'CR-0012')).to.be.false;
      });

      it('4. Exact phone match: 9866063125 matches 9866063125', () => {
        expect(normalizeIndianPhoneNumber('9866063125')).to.equal('9866063125');
      });

      it('5. +91 phone normalization: 9866063125, +91 9866063125,' +
        ' +919866063125, 09866063125 all resolve to same 10 digits', () => {
        const expected = '9866063125';
        expect(normalizeIndianPhoneNumber('9866063125')).to.equal(expected);
        expect(normalizeIndianPhoneNumber('+91 9866063125')).to.equal(expected);
        expect(normalizeIndianPhoneNumber('+919866063125')).to.equal(expected);
        expect(normalizeIndianPhoneNumber('09866063125')).to.equal(expected);
      });

      it('6. Partial phone rejected: 986606312 (9 digits) returns null', () => {
        expect(normalizeIndianPhoneNumber('986606312')).to.be.null;
      });

      it('7. Extra phone digit rejected: 98660631250 (11 digits not starting with 0) returns null', () => {
        expect(normalizeIndianPhoneNumber('98660631250')).to.be.null;
      });

      it('8. Exact name match: Ravi Kumar matches Ravi Kumar', () => {
        expect(normalizeParticipantName('Ravi Kumar')).to.equal('ravikumar');
      });

      it('9. Name case and spacing normalization: ravi kumar, RAVI KUMAR, and with extra spaces match', () => {
        const expected = 'ravikumar';
        expect(normalizeParticipantName('ravi kumar')).to.equal(expected);
        expect(normalizeParticipantName('RAVI KUMAR')).to.equal(expected);
        expect(normalizeParticipantName('  Ravi   Kumar  ')).to.equal(expected);
      });

      it('9b. Punctuation and spacing variations match: R. L. Narasimha Rao matches R.L. Narasimharao', () => {
        const expected = 'rlnarasimharao';
        expect(normalizeParticipantName('R. L. Narasimha Rao')).to.equal(expected);
        expect(normalizeParticipantName('R.L. Narasimharao')).to.equal(expected);
        expect(normalizeParticipantName('R L Narasimha Rao')).to.equal(expected);
        expect(normalizeParticipantName('r.l. narasimharao')).to.equal(expected);
        expect(normalizeParticipantName('Muddaka Sai Sneha')).to.equal('muddakasaisneha');
        expect(normalizeParticipantName('muddaka saisneha')).to.equal('muddakasaisneha');
      });

      it('10. Partial name rejected: Ravi, Ravi Ku, Ravi Kumar Test do NOT match Ravi Kumar', () => {
        const target = normalizeParticipantName('Ravi Kumar');
        expect(normalizeParticipantName('Ravi')).to.not.equal(target);
        expect(normalizeParticipantName('Ravi Ku')).to.not.equal(target);
        expect(normalizeParticipantName('Ravi Kumar Test')).to.not.equal(target);
      });

      it('10b. Missing initials or substrings rejected: Narasimha Rao does NOT match R. L. Narasimha Rao', () => {
        const target = normalizeParticipantName('R. L. Narasimha Rao');
        expect(normalizeParticipantName('Narasimha Rao')).to.not.equal(target);
        expect(normalizeParticipantName('R. L. Narasimha')).to.not.equal(target);
      });

      it('11. Multiple exact-name matches: returns all exact matches', async () => {
        const p1 = {
          _id: 'p1',
          name: 'Ravi Kumar',
          contact_type: 'participant',
          created_by_person_uuid: OTHER_USER_UUID,
          reported_date: EXPIRED,
        };
        const p2 = {
          _id: 'p2',
          name: 'RAVI KUMAR',
          contact_type: 'participant',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };
        const p3 = {
          _id: 'p3',
          name: 'Ravi Kumar Senior',
          contact_type: 'participant',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };

        dbQueryStub.resolves({ rows: [{ doc: p1 }, { doc: p2 }, { doc: p3 }] });

        const results = await service.searchExactParticipants('Ravi Kumar', 'name');
        expect(results).to.have.lengthOf(2);
        expect(results.map(r => r._id)).to.deep.equal(['p1', 'p2']);
      });
    });

    describe('Authorization & Participant Access', () => {
      it('12. Own recent participant remains accessible normally without search', async () => {
        const participant = {
          _id: 'p-own-recent', type: 'participant',
          created_by_person_uuid: CURRENT_USER_UUID, reported_date: RECENT,
        };
        const result = await service.checkAccess(participant);
        expect(result.allowed).to.be.true;
        expect(result.reason).to.equal('own');
      });

      it('13. Own expired participant remains blocked normally', async () => {
        const participant = {
          _id: 'p-own-expired', type: 'participant',
          created_by_person_uuid: CURRENT_USER_UUID, reported_date: EXPIRED,
        };
        const result = await service.checkAccess(participant);
        expect(result.allowed).to.be.false;
        expect(result.reason).to.equal('expired');
      });

      it('14. Another Intern participant remains blocked normally', async () => {
        const participant = {
          _id: 'p-other-recent', type: 'participant',
          created_by_person_uuid: OTHER_USER_UUID, reported_date: RECENT,
        };
        const result = await service.checkAccess(participant);
        expect(result.allowed).to.be.false;
        expect(result.reason).to.equal('other_user');
      });

      it('15. Exact search unlocks expired participant (allowed: true, reason: exact_search_unlocked)', async () => {
        const expiredDoc = {
          _id: 'p-expired-unlocked',
          type: 'participant',
          cr_no: 'CR-001',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };
        dbQueryStub.resolves({ rows: [{ doc: expiredDoc }] });

        // Search exact CR
        const searchResults = await service.searchExactParticipants('CR-001', 'cr_no');
        expect(searchResults).to.have.lengthOf(1);
        expect(searchResults[0]._id).to.equal('p-expired-unlocked');

        // Verify checkAccess now allows access
        const result = await service.checkAccess(expiredDoc);
        expect(result.allowed).to.be.true;
        expect(result.reason).to.equal('exact_search_unlocked');
        expect(await service.canAccess(expiredDoc)).to.be.true;
      });

      it('16. Exact search unlocks another Intern participant', async () => {
        const otherInternDoc = {
          _id: 'p-other-intern-unlocked',
          type: 'participant',
          phone: '+919866063125',
          created_by_person_uuid: OTHER_USER_UUID,
          reported_date: EXPIRED,
        };
        dbQueryStub.resolves({ rows: [{ doc: otherInternDoc }] });

        const searchResults = await service.searchExactParticipants('9866063125', 'phone');
        expect(searchResults).to.have.lengthOf(1);

        const result = await service.checkAccess(otherInternDoc);
        expect(result.allowed).to.be.true;
        expect(result.reason).to.equal('exact_search_unlocked');
      });

      it('17. Supervisor remains unrestricted regardless of exact search state', async () => {
        authServiceStub.has.withArgs('can_browse_all_participants').resolves(true);

        const doc = {
          _id: 'p-sup-check',
          type: 'participant',
          created_by_person_uuid: OTHER_USER_UUID,
          reported_date: EXPIRED,
        };

        const result = await service.checkAccess(doc);
        expect(result.allowed).to.be.true;
        expect(result.reason).to.equal('supervisor');
      });

      it('18. Failed search unlocks nothing', async () => {
        const doc = {
          _id: 'p-failed',
          type: 'participant',
          cr_no: 'CR-001',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };
        dbQueryStub.resolves({ rows: [{ doc }] });

        // Non-matching query
        const searchResults = await service.searchExactParticipants('CR-999', 'cr_no');
        expect(searchResults).to.be.empty;

        // Doc remains blocked
        const result = await service.checkAccess(doc);
        expect(result.allowed).to.be.false;
        expect(result.reason).to.equal('expired');
      });

      it('19. Searching participant A does NOT unlock participant B', async () => {
        const docA = {
          _id: 'doc-A',
          type: 'participant',
          cr_no: 'CR-A',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };
        const docB = {
          _id: 'doc-B',
          type: 'participant',
          cr_no: 'CR-B',
          created_by_person_uuid: OTHER_USER_UUID,
          reported_date: EXPIRED,
        };
        dbQueryStub.resolves({ rows: [{ doc: docA }, { doc: docB }] });

        await service.searchExactParticipants('CR-A', 'cr_no');

        // A is unlocked
        expect(await service.canAccess(docA)).to.be.true;
        // B remains blocked
        expect(await service.canAccess(docB)).to.be.false;
      });

      it('20. Direct URL to B remains blocked when only A was searched', async () => {
        const docA = {
          _id: 'direct-A',
          type: 'participant',
          cr_no: 'CR-1',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };
        const docB = {
          _id: 'direct-B',
          type: 'participant',
          cr_no: 'CR-2',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };
        dbQueryStub.resolves({ rows: [{ doc: docA }, { doc: docB }] });

        await service.searchExactParticipants('CR-1', 'cr_no');

        // Simulating direct navigation to B
        const resultB = await service.checkAccess(docB);
        expect(resultB.allowed).to.be.false;
        expect(resultB.reason).to.equal('expired');
      });
    });

    describe('Downstream Reports and Assessment Access', () => {
      it('21. Searched participant reports are accessible via canAccessReport', async () => {
        const participantA = {
          _id: 'part-A',
          type: 'participant',
          cr_no: 'CR-A',
          created_by_person_uuid: OTHER_USER_UUID,
          reported_date: EXPIRED,
        };
        dbQueryStub.resolves({ rows: [{ doc: participantA }] });
        dbGetStub.withArgs('part-A').resolves(participantA);

        await service.searchExactParticipants('CR-A', 'cr_no');

        const reportA = {
          _id: 'rep-A',
          type: 'data_record',
          form: 'ddst',
          fields: { patient_uuid: 'part-A' },
        };

        expect(await service.canAccessReport(reportA)).to.be.true;
      });

      it('22. Unsearched participant reports remain blocked via canAccessReport', async () => {
        const participantB = {
          _id: 'part-B',
          type: 'participant',
          cr_no: 'CR-B',
          created_by_person_uuid: OTHER_USER_UUID,
          reported_date: EXPIRED,
        };
        dbGetStub.withArgs('part-B').resolves(participantB);

        const reportB = {
          _id: 'rep-B',
          type: 'data_record',
          form: 'ddst',
          fields: { patient_uuid: 'part-B' },
        };

        expect(await service.canAccessReport(reportB)).to.be.false;
      });

      it('23. Searched participant assessment forms and profile are accessible', async () => {
        const participant = {
          _id: 'part-forms',
          type: 'participant',
          cr_no: 'CR-FORM',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };
        dbQueryStub.resolves({ rows: [{ doc: participant }] });

        await service.searchExactParticipants('CR-FORM', 'cr_no');

        // Profile & Enketo assessment form check
        expect(await service.canAccess(participant)).to.be.true;
      });

      it('24. Unsearched participant assessment forms remain blocked', async () => {
        const participant = {
          _id: 'part-blocked-forms',
          type: 'participant',
          cr_no: 'CR-BLOCKED',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };

        expect(await service.canAccess(participant)).to.be.false;
      });
    });

    describe('Session & State Lifecycle', () => {
      it('25. Session refresh retains exact search authorization from sessionStorage', async () => {
        const participant = {
          _id: 'part-refresh',
          type: 'participant',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };

        // Unlock in service
        service.unlockParticipant('part-refresh', CURRENT_USER_UUID);

        // Verify stored in sessionStorage
        const raw = window.sessionStorage.getItem(`cht_exact_unlocked_participants_${CURRENT_USER_UUID}`);
        expect(raw).to.include('part-refresh');

        // Instantiate fresh service instance simulating browser refresh
        const freshService = TestBed.inject(ParticipantAccessService);
        expect(freshService.isParticipantUnlocked('part-refresh', CURRENT_USER_UUID)).to.be.true;
        expect(await freshService.canAccess(participant)).to.be.true;
      });

      it('26. Logout / clear clears authorization', async () => {
        const participant = {
          _id: 'part-logout',
          type: 'participant',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        };

        service.unlockParticipant('part-logout', CURRENT_USER_UUID);
        expect(await service.canAccess(participant)).to.be.true;

        // Logout / clear
        service.clearUnlockedParticipants(CURRENT_USER_UUID);
        expect(service.isParticipantUnlocked('part-logout', CURRENT_USER_UUID)).to.be.false;
        expect(await service.canAccess(participant)).to.be.false;
      });

      it('27. User switching (Intern A -> Intern B) cannot inherit previous user unlocks', async () => {
        const participant = {
          _id: 'part-switch',
          type: 'participant',
          created_by_person_uuid: OTHER_USER_UUID,
          reported_date: EXPIRED,
        };

        // Intern A unlocks participant
        service.unlockParticipant('part-switch', CURRENT_USER_UUID);
        expect(service.isParticipantUnlocked('part-switch', CURRENT_USER_UUID)).to.be.true;

        // Intern B checks access
        expect(service.isParticipantUnlocked('part-switch', OTHER_USER_UUID)).to.be.false;
        userContactServiceStub.get.resolves({ _id: OTHER_USER_UUID });
        expect(await service.canAccess(participant)).to.be.false;
      });
    });

    describe('Data Integrity', () => {
      it('28, 29, 30. Search and unlock do not modify participant document, reported_date, or creator', async () => {
        const originalDoc = Object.freeze({
          _id: 'part-immutable',
          type: 'participant',
          cr_no: 'CR-IMMUTABLE',
          name: 'Immutable Test',
          phone: '+919866063125',
          created_by_person_uuid: CURRENT_USER_UUID,
          reported_date: EXPIRED,
        });

        dbQueryStub.resolves({ rows: [{ doc: originalDoc }] });

        const results = await service.searchExactParticipants('CR-IMMUTABLE', 'cr_no');
        expect(results).to.have.lengthOf(1);
        expect(results[0]._id).to.equal('part-immutable');
        expect(results[0].reported_date).to.equal(EXPIRED);
        expect(results[0].created_by_person_uuid).to.equal(CURRENT_USER_UUID);
        expect(results[0].cr_no).to.equal('CR-IMMUTABLE');
        expect(results[0].phone).to.equal('+919866063125');
      });
    });

    describe('Mandatory Security Acceptance Test', () => {
      it('Intern A searches A -> A, A reports, A forms open; direct B -> B, B reports, B forms blocked', async () => {
        const INTERN_A = 'intern-A-uuid';
        const INTERN_B = 'intern-B-uuid';

        // Current user is Intern A
        userContactServiceStub.get.resolves({ _id: INTERN_A });

        const partA = {
          _id: 'part-A-id',
          type: 'participant',
          cr_no: 'CR-001',
          name: 'Participant A',
          created_by_person_uuid: INTERN_A,
          reported_date: EXPIRED,
        };

        const partB = {
          _id: 'part-B-id',
          type: 'participant',
          cr_no: 'CR-002',
          name: 'Participant B',
          created_by_person_uuid: INTERN_B,
          reported_date: EXPIRED,
        };

        const reportA = {
          _id: 'report-A-id',
          type: 'data_record',
          form: 'moca',
          fields: { patient_uuid: 'part-A-id' },
        };

        const reportB = {
          _id: 'report-B-id',
          type: 'data_record',
          form: 'moca',
          fields: { patient_uuid: 'part-B-id' },
        };

        dbQueryStub.resolves({ rows: [{ doc: partA }, { doc: partB }] });
        dbGetStub.withArgs('part-A-id').resolves(partA);
        dbGetStub.withArgs('part-B-id').resolves(partB);

        // Step 1: Intern A searches exact A by CR
        const searchRes = await service.searchExactParticipants('CR-001', 'cr_no');
        expect(searchRes).to.have.lengthOf(1);
        expect(searchRes[0]._id).to.equal('part-A-id');

        // Step 2: Confirm A opens (canAccess === true)
        expect(await service.canAccess(partA)).to.be.true;

        // Step 3: Confirm A's reports open (canAccessReport === true)
        expect(await service.canAccessReport(reportA)).to.be.true;

        // Step 4: Confirm A's assessment forms open
        const resultA = await service.checkAccess(partA);
        expect(resultA.allowed).to.be.true;
        expect(resultA.reason).to.equal('exact_search_unlocked');

        // Step 5: Directly navigate to B
        // Step 6: Confirm B is blocked
        const resultB = await service.checkAccess(partB);
        expect(resultB.allowed).to.be.false;
        expect(resultB.reason).to.equal('other_user');
        expect(await service.canAccess(partB)).to.be.false;

        // Step 7: Confirm B's reports are blocked
        expect(await service.canAccessReport(reportB)).to.be.false;

        // Step 8: Confirm B's forms are blocked
        expect(await service.canAccess(partB)).to.be.false;
      });
    });
  });

  describe('Reports list summaries (no fields)', () => {
    it('reads the full report to find the participant of a list summary', async () => {
      dbGetStub.withArgs('rep-summary').resolves({
        _id: 'rep-summary',
        form: 'ddst',
        fields: { patient_uuid: 'part-own-3' },
      });
      dbGetStub.withArgs('part-own-3').resolves({
        _id: 'part-own-3',
        type: 'participant',
        created_by_person_uuid: CURRENT_USER_UUID,
        reported_date: Date.now() - (60 * 60 * 1000),
      });

      const allowed = await service.canAccessReport({ _id: 'rep-summary', form: 'ddst', subject: { value: 'NIMS-1' } });
      expect(allowed).to.be.true;
    });

    it('shows reports of a participant unlocked by exact search, after the visibility window', async () => {
      dbGetStub.withArgs('rep-old').resolves({
        _id: 'rep-old',
        form: 'moca_assessment',
        fields: { patient_uuid: 'part-old' },
      });
      dbGetStub.withArgs('part-old').resolves({
        _id: 'part-old',
        type: 'participant',
        created_by_person_uuid: OTHER_USER_UUID,
        reported_date: Date.now() - (30 * 24 * 60 * 60 * 1000),
      });
      expect(await service.canAccessReport({ _id: 'rep-old', form: 'moca_assessment' })).to.be.false;

      service.unlockParticipant('part-old', CURRENT_USER_UUID);
      expect(await service.canAccessReport({ _id: 'rep-old', form: 'moca_assessment' })).to.be.true;
    });

    it('hides the report if the full report cannot be read', async () => {
      dbGetStub.withArgs('rep-missing').rejects({ status: 404 });
      expect(await service.canAccessReport({ _id: 'rep-missing', form: 'dst' })).to.be.false;
    });
  });
});

