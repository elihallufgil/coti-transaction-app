import { BaseEntity } from './base.entity';
import { Column, Entity, EntityManager } from 'typeorm';
import { TableNames } from './table-names';

@Entity(TableNames.ACTIVITIES)
export class ActivitiesEntity extends BaseEntity {
  @Column()
  transactionId: number;

  @Column()
  tokenId: number;

  @Column()
  actionId: number;

  @Column()
  from: string;

  @Column()
  to: string;

  @Column()
  data: string;
}

export const createActivityEntity = async (
  manager: EntityManager,
  activity?: Partial<ActivitiesEntity>,
): Promise<ActivitiesEntity> => {
  const newActivity = manager.create(ActivitiesEntity, activity);
  return manager.save(newActivity);
};
