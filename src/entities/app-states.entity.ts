import { Column, Entity, EntityManager } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TableNames } from '../table-names';
import { exec } from '../../utils';

@Entity(TableNames.APP_STATES)
export class AppStatesEntity extends BaseEntity {
  @Column()
  name: string;

  @Column()
  value: string;
}

export const getAppStateByName = async (manager: EntityManager, name: string, lock: boolean): Promise<AppStatesEntity> => {
  const query = manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).createQueryBuilder().where({ name });
  if (lock) {
    query.setLock('pessimistic_write');
  }
  const [err, appState] = await exec(query.getOne());
  if (err) throw err;
  return appState;
};

export const updateAppStateEntity = async (manager: EntityManager, appEntity?: AppStatesEntity): Promise<void> => {
  const [err] = await exec(manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).save(appEntity));
  if (err) throw err;
};

export const createAppStateEntity = async (manager: EntityManager, name: string, value: string): Promise<void> => {
  const appState = {
    name,
    value,
  };
  const appStateToSave = manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).create(appState);

  const [err] = await exec(manager.getRepository<AppStatesEntity>(TableNames.APP_STATES).save(appStateToSave));
  if (err) throw err;
};
