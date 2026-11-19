import { Injectable, OnDestroy } from '@angular/core';
import { find as _find } from 'lodash-es';
import { Subscription } from 'rxjs';

import { DbService } from '@mm-services/db.service';
import { ChangesService } from '@mm-services/changes.service';
import { SessionService } from '@mm-services/session.service';
import { ReadDocsProvider } from '@mm-providers/read-docs.provider';
import { AuthService } from '@mm-services/auth.service';
import { ParticipantAccessService } from '@mm-services/participant-access.service';
import { DOC_TYPES } from '@medic/constants';

@Injectable({
  providedIn: 'root'
})
export class UnreadRecordsService implements OnDestroy {
  subscriptions: Subscription = new Subscription();
  private readonly TYPES = [ 'report', 'message' ];
  private callback;

  constructor(
    private dbService: DbService,
    private changesService: ChangesService,
    private sessionService: SessionService,
    private readDocsProvider: ReadDocsProvider,
    private authService: AuthService,
    private participantAccessService: ParticipantAccessService
  ) { }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private getTotal() {
    return this.dbService
      .get()
      .query('medic-client/data_records_by_type', { group: true });
  }

  private getRead() {
    return this.dbService
      .get({ meta: true })
      .query('medic-user/read', { group: true });
  }

  private getRowValueForType(type, response:any = {}) {
    const result = _find(response.rows, { key: type });
    return (result && result.value) || 0;
  }

  private getCount(callback) {
    return Promise
      .all([
        this.getTotal(),
        this.getRead()
      ])
      .then(async ([total, read]) => {
        const result = this.TYPES.reduce((countMap, type) => {
          countMap[type] = this.getRowValueForType(type, total) - this.getRowValueForType(type, read);
          return countMap;
        }, {});

        try {
          const canBrowseAll = (await this.authService.has('can_browse_all_participants')) ||
                               (await this.authService.has('can_view_participants'));
          if (!canBrowseAll) {
            // For interns: do not show total unread count across CouchDB (e.g. 77)
            // Instead, count only unread reports from their accessible 24-hour window.
            const metaDb = this.dbService.get({ meta: true });
            const readRes = await metaDb.allDocs({
              startkey: 'read:report:',
              endkey: 'read:report:\ufff0'
            }).catch(() => ({ rows: [] }));
            const readSet = new Set((readRes.rows || []).map(r => r.id.replace('read:report:', '')));

            const db = this.dbService.get();
            const recent = await db.query('medic-client/reports_by_date', {
              descending: true,
              limit: 50,
              include_docs: true,
            }).catch(() => ({ rows: [] }));

            let accessibleUnread = 0;
            for (const row of recent.rows) {
              if (row.doc && !readSet.has(row.id)) {
                const allowed = await this.participantAccessService.canAccessReport(row.doc);
                if (allowed) {
                  accessibleUnread++;
                }
              }
            }
            result['report'] = accessibleUnread;
          }
        } catch (_err) {
          // Keep default if access check fails
        }

        if (callback) {
          callback(null, result);
        }
      })
      .catch(error => {
        if (callback) {
          callback(error);
        }
      });
  }

  private updateReadDocs(change) {
    // update the meta db if a doc is deleted by a non-admin
    // admin dbs are updated by sentinel instead
    if (!change.deleted || this.sessionService.isOnlineOnly()) {
      return Promise.resolve();
    }

    const metaDb = this.dbService.get({ meta: true });

    return metaDb
      .get(this.readDocsProvider.getId(change.doc))
      .then((doc) => {
        doc._deleted = true;
        return metaDb.put(doc);
      })
      .catch((err) => {
        if (err.status !== 404) {
          // the doc hasn't been read yet
          throw err;
        }
      });
  }

  private changeHandler(change, callback) {
    return this
      .updateReadDocs(change)
      .then(() => this.getCount(callback));
  }

  init(callback) {
    this.callback = callback;
    // wait for db.info to avoid uncaught exceptions: #3754
    this.dbService
      .get()
      .info()
      .then(() => {
        // get the initial count
        this.getCount(this.callback);

        // listen for changes in the medic db and update the count
        const statusMedicSubscription = this.changesService.subscribe({
          key: 'read-status-medic',
          debounce: 500, // Reacting once all consecutive changes are done (example: after replication of docs)
          filter: (change) => change.doc && change.doc.type === DOC_TYPES.DATA_RECORD,
          callback: (change) => this.changeHandler(change, this.callback)
        });
        this.subscriptions.add(statusMedicSubscription);

        // listen for changes in the meta db and update the count
        const statusMetaSubscription = this.changesService.subscribe({
          metaDb: true,
          key: 'read-status-meta',
          debounce: 500, // Reacting once all consecutive changes are done (example: after replication of docs
          callback: () => this.getCount(this.callback)
        });
        this.subscriptions.add(statusMetaSubscription);
      });
  }

  count() {
    return this.getCount(this.callback);
  }

}
