import { TestBed } from '@angular/core/testing';
import sinon from 'sinon';
import { expect } from 'chai';

import { ExactSearchService } from '@mm-services/exact-search.service';
import { DbService } from '@mm-services/db.service';

describe('ExactSearchService', () => {
  let allDocs: sinon.SinonStub;
  let service: ExactSearchService;
  let docs: Record<string, any>;

  beforeEach(() => {
    docs = {
      kamala: { _id: 'kamala', name: 'Kamala  Devi', patient_id: 'NIMS-79704', phone: '+91 90000 10001' },
      kavya: { _id: 'kavya', name: 'Kavya', cr_no: 'CR-12', alternate_phone: '9000010002' },
      r1: { _id: 'r1', form: 'moca', fields: { patient_name: 'Someone Else', patient_uuid: 'kamala' } },
      r2: { _id: 'r2', form: 'moca', fields: { patient_id: 'CR-12' } },
      r3: { _id: 'r3', form: 'moca', fields: { place_id: 'nobody' } },
    };
    allDocs = sinon.stub().callsFake(({ keys }) => Promise.resolve({
      rows: keys.map(key => (docs[key] ? { id: key, doc: docs[key] } : { key, error: 'not_found' })),
    }));
    TestBed.configureTestingModule({
      providers: [{ provide: DbService, useValue: { get: () => ({ allDocs }) } }],
    });
    service = TestBed.inject(ExactSearchService);
  });

  afterEach(() => sinon.restore());

  it('is only enabled for plain text searches when the setting is on', () => {
    expect(service.isEnabled({ search_exact_match: true }, 'Kamala')).to.be.true;
    expect(service.isEnabled({ search_exact_match: false }, 'Kamala')).to.be.false;
    expect(service.isEnabled({}, 'Kamala')).to.be.false;
    expect(service.isEnabled({ search_exact_match: true }, '   ')).to.be.false;
    expect(service.isEnabled({ search_exact_match: true }, undefined)).to.be.false;
    expect(service.isEnabled({ search_exact_match: true }, 'patient_id:NIMS-1')).to.be.false;
  });

  it('matches whole names ignoring case and extra spaces, never partial names', async () => {
    expect(await service.filter('contacts', ['kamala', 'kavya'], ' kamala devi ')).to.deep.equal(['kamala']);
    expect(await service.filter('contacts', ['kamala', 'kavya'], 'Ka')).to.deep.equal([]);
  });

  it('matches whole IDs and CR numbers', async () => {
    expect(await service.filter('contacts', ['kamala', 'kavya'], 'nims-79704')).to.deep.equal(['kamala']);
    expect(await service.filter('contacts', ['kamala', 'kavya'], 'NIMS-797')).to.deep.equal([]);
    expect(await service.filter('contacts', ['kamala', 'kavya'], 'CR-12')).to.deep.equal(['kavya']);
  });

  it('matches whole phone numbers with or without the country code', async () => {
    expect(await service.filter('contacts', ['kamala', 'kavya'], '9000010001')).to.deep.equal(['kamala']);
    expect(await service.filter('contacts', ['kamala', 'kavya'], '+919000010002')).to.deep.equal(['kavya']);
    expect(await service.filter('contacts', ['kamala', 'kavya'], '10001')).to.deep.equal([]);
  });

  it('matches reports by their own fields or by their participant', async () => {
    expect(await service.filter('reports', ['r1', 'r2', 'r3'], 'Kamala Devi')).to.deep.equal(['r1']);
    expect(await service.filter('reports', ['r1', 'r2', 'r3'], 'someone else')).to.deep.equal(['r1']);
    expect(await service.filter('reports', ['r1', 'r2', 'r3'], 'CR-12')).to.deep.equal(['r2']);
    expect(await service.filter('reports', ['r1', 'r2', 'r3'], 'nobody')).to.deep.equal([]);
  });

  it('handles empty results and deleted documents', async () => {
    expect(await service.filter('contacts', [], 'Kamala Devi')).to.deep.equal([]);
    expect(await service.filter('contacts', ['gone', 'kamala'], 'Kamala Devi')).to.deep.equal(['kamala']);
    expect(allDocs.callCount).to.equal(1);
  });
});
