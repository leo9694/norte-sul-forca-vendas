import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MonthlyGoal } from '../app/goals-model';
import { defaultGoalSettings, type GoalCampaign, type GoalSettings } from '../app/goals-central-model.ts';
import { validateGoalAllocations } from '../app/goals-registration.ts';
let database: DatabaseSync | null=null;
function db() {
  if (database) return database;
  const filename=path.resolve(process.env.MONTHLY_GOALS_DATABASE_PATH || path.join(process.cwd(),'data','monthly-goals.sqlite'));
  mkdirSync(path.dirname(filename),{recursive:true});
  database=new DatabaseSync(filename);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS monthly_goals(month TEXT NOT NULL,seller_id INTEGER NOT NULL,target_cents INTEGER NOT NULL,
      notes TEXT NOT NULL,version INTEGER NOT NULL,updated_at INTEGER NOT NULL,updated_by INTEGER NOT NULL,deleted_at INTEGER,
      PRIMARY KEY(month,seller_id));
    CREATE TABLE IF NOT EXISTS monthly_goal_history(id INTEGER PRIMARY KEY,month TEXT NOT NULL,seller_id INTEGER NOT NULL,
      action TEXT NOT NULL,payload TEXT NOT NULL,user_id INTEGER NOT NULL,created_at INTEGER NOT NULL);`);
  return database;
}
export function listMonthlyGoals(month: string, sellerId?: number): MonthlyGoal[] {
  return db().prepare(`SELECT month,seller_id,target_cents,notes,version,updated_at FROM monthly_goals
    WHERE month=? AND deleted_at IS NULL ${sellerId ? 'AND seller_id=?' : ''} ORDER BY seller_id`).all(...(sellerId ? [month,sellerId] : [month])) as unknown as MonthlyGoal[];
}
export function saveMonthlyGoal(month: string, sellerId: number, targetCents: number, notes: string, version: number, userId: number, remove=false) {
  const database=db();database.exec('BEGIN IMMEDIATE');
  try {
    const previous=database.prepare('SELECT * FROM monthly_goals WHERE month=? AND seller_id=?').get(month,sellerId);
    const expected=previous && previous.deleted_at===null ? Number(previous.version) : 0;
    if (version!==expected || (remove && !expected)) throw Error('GOAL_CONFLICT');
    const now=Date.now(), nextVersion=Number(previous?.version || 0)+1;
    if (remove) database.prepare('UPDATE monthly_goals SET deleted_at=?,version=?,updated_at=?,updated_by=? WHERE month=? AND seller_id=?').run(now,nextVersion,now,userId,month,sellerId);
    else database.prepare(`INSERT INTO monthly_goals VALUES(?,?,?,?,?,?,?,NULL)
      ON CONFLICT(month,seller_id) DO UPDATE SET target_cents=excluded.target_cents,notes=excluded.notes,version=excluded.version,
      updated_at=excluded.updated_at,updated_by=excluded.updated_by,deleted_at=NULL`).run(month,sellerId,targetCents,notes,nextVersion,now,userId);
    database.prepare('INSERT INTO monthly_goal_history(month,seller_id,action,payload,user_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(month,sellerId,remove?'remove':'save',JSON.stringify({previous:previous ?? null,targetCents,notes,version:nextVersion}),userId,now);
    database.exec('COMMIT');
  } catch(error) {database.exec('ROLLBACK');throw error;}
}

let centralReady=false;
function centralDb(){
  const database=db();if(centralReady)return database;
  database.exec(`CREATE TABLE IF NOT EXISTS goal_sets(id TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS goal_audit(id INTEGER PRIMARY KEY,set_id TEXT NOT NULL,user_id INTEGER NOT NULL,user_name TEXT NOT NULL,created_at INTEGER NOT NULL,previous TEXT,next TEXT);
    CREATE TABLE IF NOT EXISTS goal_config(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS goal_migrations(id TEXT PRIMARY KEY);`);
  database.exec('BEGIN IMMEDIATE');
  try{
    if(!database.prepare("SELECT id FROM goal_migrations WHERE id='monthly-v1'").get()){
      const legacy=database.prepare('SELECT * FROM monthly_goals WHERE deleted_at IS NULL').all();
      for(const row of legacy){
        const month=String(row.month),last=new Date(month+'-01T12:00:00Z');last.setUTCMonth(last.getUTCMonth()+1,0);
        const campaign:GoalCampaign={id:`legacy-${month}-${row.seller_id}`,description:`Meta mensal ${month.split('-').reverse().join('/')}`,type:'general',companies:[1,6,8],start:month+'-01',end:last.toISOString().slice(0,10),brand:'',group:0,status:'active',notes:String(row.notes),version:1,
          assignments:[{sellerId:Number(row.seller_id),targetCents:Number(row.target_cents)}],createdBy:Number(row.updated_by),createdName:`Usuário ${row.updated_by}`,createdAt:Number(row.updated_at),updatedAt:Number(row.updated_at)};
        database.prepare('INSERT OR IGNORE INTO goal_sets VALUES(?,?,?)').run(campaign.id,JSON.stringify(campaign),1);
        const history=database.prepare('SELECT * FROM monthly_goal_history WHERE month=? AND seller_id=? ORDER BY id').all(month,Number(row.seller_id));
        const snapshot=(value:Record<string,unknown>|null)=>value?JSON.stringify({...campaign,notes:String(value.notes||''),version:Number(value.version||1),assignments:[{sellerId:Number(row.seller_id),targetCents:Number(value.target_cents||0)}]}):null;
        for(const entry of history){
          const payload=JSON.parse(String(entry.payload));
          database.prepare('INSERT INTO goal_audit(set_id,user_id,user_name,created_at,previous,next) VALUES(?,?,?,?,?,?)').run(campaign.id,Number(entry.user_id),`Usuário ${entry.user_id}`,Number(entry.created_at),snapshot(payload.previous),entry.action==='remove'?null:snapshot({target_cents:payload.targetCents,notes:payload.notes,version:payload.version}));
        }
      }
      database.prepare("INSERT INTO goal_migrations VALUES('monthly-v1')").run();
    }
    database.exec('COMMIT');centralReady=true;
  }catch(error){database.exec('ROLLBACK');throw error;}
  return database;
}
export function listGoalSets():GoalCampaign[]{return centralDb().prepare('SELECT payload FROM goal_sets ORDER BY id').all().map(r=>JSON.parse(String(r.payload)));}
export function readGoalSettings():GoalSettings{
  const row=centralDb().prepare('SELECT payload,version FROM goal_config WHERE id=1').get();
  return row?{...defaultGoalSettings,...JSON.parse(String(row.payload)),version:Number(row.version)}:{...defaultGoalSettings};
}
export function saveGoalSettings(settings:GoalSettings,userId:number,userName:string){
  const database=centralDb();database.exec('BEGIN IMMEDIATE');
  try{const previous=readGoalSettings();if(previous.version!==settings.version)throw Error('GOAL_CONFLICT');
    const next={...settings,version:previous.version+1};
    database.prepare('INSERT INTO goal_config VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version').run(JSON.stringify(next),next.version);
    database.prepare('INSERT INTO goal_audit(set_id,user_id,user_name,created_at,previous,next) VALUES(?,?,?,?,?,?)').run('settings',userId,userName,Date.now(),JSON.stringify(previous),JSON.stringify(next));database.exec('COMMIT');
  }catch(error){database.exec('ROLLBACK');throw error;}
}
export function saveGoalSets(changes:GoalCampaign[],userId:number,userName:string){
  const database=centralDb();database.exec('BEGIN IMMEDIATE');
  try{
    const previousSets=listGoalSets(),all=[...previousSets];
    for(const change of changes){
      const previous=all.find(c=>c.id===change.id);
      if((previous?.version||0)!==change.version)throw Error('GOAL_CONFLICT');
      if(previous?.status==='closed')throw Error('GOAL_CLOSED');
      const next={...change,createdAt:previous?.createdAt||Date.now(),createdBy:previous?.createdBy||userId,createdName:previous?.createdName||userName,updatedAt:Date.now(),version:(previous?.version||0)+1};
      const index=all.findIndex(c=>c.id===next.id);if(index<0)all.push(next);else all[index]=next;
    }
    validateGoalAllocations(previousSets,changes);
    const live=all.filter(c=>c.status!=='cancelled');
    for(const c of changes.filter(c=>c.status!=='cancelled')){
      if(live.some(other=>other.id!==c.id&&other.type===c.type&&other.brand===c.brand&&other.group===c.group&&other.start<=c.end&&other.end>=c.start
        &&other.companies.some(id=>c.companies.includes(id))&&other.assignments.some(a=>c.assignments.some(b=>b.sellerId===a.sellerId))))throw Error('GOAL_OVERLAP');
    }
    for(const change of changes){
      const previous=database.prepare('SELECT payload FROM goal_sets WHERE id=?').get(change.id),next=all.find(c=>c.id===change.id)!;
      database.prepare('INSERT INTO goal_sets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version').run(next.id,JSON.stringify(next),next.version);
      database.prepare('INSERT INTO goal_audit(set_id,user_id,user_name,created_at,previous,next) VALUES(?,?,?,?,?,?)').run(next.id,userId,userName,next.updatedAt,previous?String(previous.payload):null,JSON.stringify(next));
    }
    database.exec('COMMIT');
  }catch(error){database.exec('ROLLBACK');throw error;}
}
export function goalAudit(ids:string[],before=Number.MAX_SAFE_INTEGER){
  if(!ids.length)return [];
  return centralDb().prepare(`SELECT * FROM goal_audit WHERE set_id IN (${ids.map(()=>'?').join(',')}) AND id<? ORDER BY id DESC LIMIT 100`).all(...ids,before);
}
