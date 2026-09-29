<?php
declare(strict_types=1);
namespace Upgrade\Core;

final class Gateway
{
    private \Bitrix\Main\DB\Connection $db;
    private string $project;
    private mixed $lock;
    private int $iblock;
    private array $assetIndex=[];
    public function __construct(string $project, string $lockDirectory)
    {
        if (PHP_SAPI!=='cli' || getenv('UPGRADE_DEMO')!=='1' || getenv('UPGRADE_PROJECT_ID')!==$project || !defined('UPGRADE_SANDBOX_PREPEND_ACTIVE') || UPGRADE_SANDBOX_PREPEND_ACTIVE!==true) { throw new \RuntimeException('CLI_DEMO_PROJECT_BINDING_REQUIRED'); }
        if (!\Bitrix\Main\Loader::includeModule('iblock')) { throw new \RuntimeException('IBLOCK_MODULE_REQUIRED'); }
        if (!is_dir($lockDirectory) || is_link($lockDirectory)) { throw new \RuntimeException('PRIVATE_LOCK_DIRECTORY_REQUIRED'); }
        $this->project=$project; $this->db=\Bitrix\Main\Application::getConnection();
        $this->lock=fopen($lockDirectory.'/upgrade-'.$project.'.lock','c');
        if (!$this->lock || !flock($this->lock,LOCK_EX|LOCK_NB)) { throw new \RuntimeException('TARGET_WRITER_BUSY'); }
        $row=$this->db->query('SELECT * FROM ug_project WHERE PROJECT_ID='.$this->q($project))->fetch();
        if (!$row) { throw new \RuntimeException('PROJECT_NOT_INSTALLED'); }
        $this->iblock=(int)$row['IBLOCK_ID'];
    }
    public function __destruct() { if (isset($this->lock) && is_resource($this->lock)) { flock($this->lock,LOCK_UN); fclose($this->lock); } }
    private function q(string $value): string { return "'".$this->db->getSqlHelper()->forSql($value)."'"; }
    private static function encode(mixed $value): string { return json_encode($value,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); }
    private static function h(string $text): string { return htmlspecialchars($text,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
    public function claim(string $owner, int $ttl=300): array
    {
        if (!preg_match('/^[a-zA-Z0-9_.-]{1,128}$/',$owner) || $ttl<30 || $ttl>3600) { throw new \RuntimeException('INVALID_OWNER_OR_TTL'); }
        $this->db->startTransaction();
        try {
            $row=$this->db->query('SELECT FENCE,OWNER,LEASE_UNTIL FROM ug_project WHERE PROJECT_ID='.$this->q($this->project).' FOR UPDATE')->fetch();
            // The filesystem lock and row lock synchronize hand-off with completion of every old transaction.
            if ((int)$row['LEASE_UNTIL']>time() && $row['OWNER']!==$owner) { throw new \RuntimeException('TARGET_LEASE_ACTIVE'); }
            $fence=(int)$row['FENCE']+1; $expires=time()+$ttl;
            $this->db->queryExecute('UPDATE ug_project SET FENCE='.$fence.',OWNER='.$this->q($owner).',LEASE_UNTIL='.$expires.' WHERE PROJECT_ID='.$this->q($this->project));
            $this->db->commitTransaction(); return ['fence'=>$fence,'owner'=>$owner,'lease_until'=>$expires];
        } catch (\Throwable $error) { $this->db->rollbackTransaction(); throw $error; }
    }
    private function fence(int $token,string $owner): void
    {
        $row=$this->db->query('SELECT FENCE,OWNER,LEASE_UNTIL FROM ug_project WHERE PROJECT_ID='.$this->q($this->project).' FOR UPDATE')->fetch();
        if (!$row || (int)$row['FENCE']!==$token || $row['OWNER']!==$owner || (int)$row['LEASE_UNTIL']<=time()) { throw new \RuntimeException('STALE_TARGET_FENCE'); }
    }
    private function current(string $key): ?array
    {
        $rows=\CIBlockElement::GetList([],['IBLOCK_ID'=>$this->iblock,'=XML_ID'=>'upgrade:'.$key],false,['nTopCount'=>2],['ID','NAME','DETAIL_TEXT','DETAIL_TEXT_TYPE','PREVIEW_TEXT','PREVIEW_TEXT_TYPE']);
        $item=$rows->Fetch(); if (!$item) { return null; }
        if ($rows->Fetch()) { throw new \RuntimeException('DUPLICATE_EXTERNAL_ID:'.$key); }
        $properties=[];
        foreach (['UG_SEO_TITLE','UG_DESCRIPTION','UG_H1','UG_FACTS'] as $code) {
            $row=\CIBlockElement::GetProperty($this->iblock,(int)$item['ID'],[],['CODE'=>$code])->Fetch();
            $properties[$code]=(string)($row['VALUE']??'');
        }
        return ['id'=>(int)$item['ID'],'managed'=>['NAME'=>(string)$item['NAME'],'DETAIL_TEXT'=>(string)$item['DETAIL_TEXT'],'DETAIL_TEXT_TYPE'=>(string)$item['DETAIL_TEXT_TYPE'],'PREVIEW_TEXT'=>(string)$item['PREVIEW_TEXT'],'PREVIEW_TEXT_TYPE'=>(string)$item['PREVIEW_TEXT_TYPE'],'properties'=>$properties]];
    }
    private function fields(array $entity): array
    {
        $html=[];
        foreach ($entity['blocks'] as $block) {
            $text=self::h((string)($block['text']??''));
            switch ($block['type']) {
                case 'paragraph': $html[]='<p>'.$text.'</p>'; break;
                case 'heading': $level=max(2,min(6,(int)($block['level']??2))); $html[]='<h'.$level.'>'.$text.'</h'.$level.'>'; break;
                case 'quote': $html[]='<blockquote>'.$text.'</blockquote>'; break;
                case 'list': $html[]='<ul>'.implode('',array_map(static fn($item)=>'<li>'.self::h((string)$item).'</li>', $block['items']??[])).'</ul>'; break;
                case 'table': $html[]='<div class="table-scroll" tabindex="0" role="region" aria-label="Таблица: используйте стрелки для прокрутки"><table><tbody>'.implode('',array_map(static fn($row)=>'<tr>'.implode('',array_map(static fn($cell)=>'<td>'.self::h((string)$cell).'</td>',$row)).'</tr>',$block['rows']??[])).'</tbody></table></div>'; break;
                case 'image':
                    $asset=$this->assetIndex[$block['asset_sha256']]??null;
                    if (!$asset||!str_starts_with($asset['mime'],'image/')) { throw new \RuntimeException('IMAGE_ASSET_MISSING'); }
                    $html[]='<figure><img loading="lazy" src="'.self::h($asset['public_path']).'" alt="'.self::h((string)($block['alt']??'')).'"></figure>'; break;
                case 'document':
                    $asset=$this->assetIndex[$block['asset_sha256']]??null;
                    if (!$asset||$asset['mime']!=='application/pdf') { throw new \RuntimeException('DOCUMENT_ASSET_MISSING'); }
                    $html[]='<p><a href="'.self::h($asset['public_path']).'" download>'.($text?:'Скачать документ').'</a></p>'; break;
                default: throw new \RuntimeException('UNSUPPORTED_CONTENT_BLOCK');
            }
        }
        $seo=$entity['seo']??[];
        return ['NAME'=>$entity['title'],'DETAIL_TEXT'=>implode("\n",$html),'DETAIL_TEXT_TYPE'=>'html','PREVIEW_TEXT'=>(string)($entity['description']??''),'PREVIEW_TEXT_TYPE'=>'text','properties'=>['UG_SEO_TITLE'=>(string)($seo['title']??$entity['title']),'UG_DESCRIPTION'=>(string)($seo['description']??$entity['description']??''),'UG_H1'=>(string)($seo['h1']??$entity['title']),'UG_FACTS'=>self::encode($entity['facts']??[])]];
    }
    private function planEntity(array $entity): array
    {
        $key=$entity['stable_key']; $desired=$this->fields($entity); $desiredHash=hash('sha256',self::encode($desired));
        $current=$this->current($key);
        $mapped=$this->db->query('SELECT * FROM ug_entity WHERE ENTITY_KEY='.$this->q($key).' AND PROJECT_ID='.$this->q($this->project))->fetch();
        if ($mapped && (!$current || (int)$mapped['BITRIX_ID']!==$current['id'])) { throw new \RuntimeException('MAPPING_DRIFT:'.$key); }
        if (!$current) { return ['action'=>'created','fields'=>$desired,'hash'=>$desiredHash,'id'=>null]; }
        $currentHash=hash('sha256',self::encode($current['managed']));
        if (hash_equals($desiredHash,$currentHash)) { return ['action'=>$mapped?'skipped':'reconciled','fields'=>$desired,'hash'=>$desiredHash,'id'=>$current['id']]; }
        // Recovering an unknown prior write never overwrites an unowned or manually changed row.
        if (!$mapped || !hash_equals($mapped['MANAGED_HASH'],$currentHash)) { throw new \RuntimeException('USER_EDIT_CONFLICT:'.$key); }
        return ['action'=>'updated','fields'=>$desired,'hash'=>$desiredHash,'id'=>$current['id']];
    }
    public function dryRun(array $package): array
    {
        $this->assetIndex=$package['asset_index'];
        $result=['created'=>0,'updated'=>0,'skipped'=>0,'reconciled'=>0,'conflicts'=>[],'blockers'=>$package['manifest']['blockers']];
        foreach ($package['entities'] as $entity) {
            try { $plan=$this->planEntity($entity); $result[$plan['action']]++; }
            catch (\Throwable $error) { $result['conflicts'][]=['source_id'=>$entity['source_id'],'reason'=>$error->getMessage()]; }
        }
        return $result;
    }
    public function apply(array $package,int $token,string $owner,string $checkpointDir): array
    {
        if ($package['manifest']['blockers']) { throw new \RuntimeException('PACKAGE_HAS_BLOCKERS'); }
        if (!is_dir($checkpointDir) || is_link($checkpointDir)) { throw new \RuntimeException('PRIVATE_CHECKPOINT_DIRECTORY_REQUIRED'); }
        $dry=$this->dryRun($package);
        if ($dry['conflicts']) { throw new \RuntimeException('DRY_RUN_CONFLICTS:'.self::encode($dry['conflicts'])); }
        $summary=['created'=>0,'updated'=>0,'skipped'=>0,'reconciled'=>0,'routes'=>0,'errors'=>0];
        $packageHash=$package['manifest_hash'];
        // Immutable content-addressed resources are separate from DB transactions. Interrupted temp files
        // have an explicit suffix; committed orphan files are reported and never automatically deleted.
        $mediaRoot=$_SERVER['DOCUMENT_ROOT'].'/upload/upgrade/'.$this->project;
        if (!is_dir($mediaRoot) && !mkdir($mediaRoot,0755,true) && !is_dir($mediaRoot)) { throw new \RuntimeException('MEDIA_DIRECTORY_FAILED'); }
        if (is_link($mediaRoot)||!str_starts_with((string)realpath($mediaRoot),(string)realpath($_SERVER['DOCUMENT_ROOT']).DIRECTORY_SEPARATOR)) { throw new \RuntimeException('MEDIA_DIRECTORY_ESCAPE'); }
        $this->db->startTransaction();
        try {
            $this->fence($token,$owner);
            foreach ($package['assets'] as $asset) {
                $destination=$mediaRoot.'/'.basename($asset['path']);
                if (is_link($destination)) { throw new \RuntimeException('MEDIA_SYMLINK'); }
                if (is_file($destination)) { if (!hash_equals($asset['sha256'],(string)hash_file('sha256',$destination))) { throw new \RuntimeException('MEDIA_CONFLICT'); } continue; }
                $temp=$destination.'.pending-'.$token;
                if (is_link($temp)) { throw new \RuntimeException('MEDIA_TEMP_SYMLINK'); }
                if (!copy($package['root'].'/'.$asset['path'],$temp)||!hash_equals($asset['sha256'],(string)hash_file('sha256',$temp))||!rename($temp,$destination)) { throw new \RuntimeException('MEDIA_COPY_FAILED'); }
            }
            $this->fence($token,$owner); $this->db->commitTransaction();
        } catch (\Throwable $error) { $this->db->rollbackTransaction(); throw $error; }
        // Bounded transaction per entity: entity + mapping + operation form a single checkpoint.
        foreach ($package['entities'] as $entity) {
            $this->db->startTransaction();
            try {
                $this->fence($token,$owner);
                $plan=$this->planEntity($entity); $fields=$plan['fields']; $properties=$fields['properties']; unset($fields['properties']);
                $element=new \CIBlockElement(); $id=$plan['id'];
                if ($plan['action']==='created') {
                    $id=$element->Add($fields+['IBLOCK_ID'=>$this->iblock,'XML_ID'=>'upgrade:'.$entity['stable_key'],'ACTIVE'=>'Y','PROPERTY_VALUES'=>$properties],false,false);
                    if (!$id) { throw new \RuntimeException('ELEMENT_ADD_FAILED:'.$element->LAST_ERROR); }
                } elseif ($plan['action']==='updated') {
                    if (!$element->Update($id,$fields,false,false)) { throw new \RuntimeException('ELEMENT_UPDATE_FAILED:'.$element->LAST_ERROR); }
                    \CIBlockElement::SetPropertyValuesEx($id,$this->iblock,$properties);
                }
                $actual=$this->current($entity['stable_key']);
                if (!$actual || !hash_equals($plan['hash'],hash('sha256',self::encode($actual['managed'])))) { throw new \RuntimeException('POST_WRITE_RECONCILE_FAILED'); }
                $key=$entity['stable_key']; $payloadHash=hash('sha256',self::encode($entity));
                $this->db->queryExecute('INSERT INTO ug_entity (ENTITY_KEY,PROJECT_ID,ENTITY_TYPE,SOURCE_ID,BITRIX_ID,MANAGED_HASH,PAYLOAD_HASH) VALUES ('.$this->q($key).','.$this->q($this->project).','.$this->q($entity['type']).','.$this->q($entity['source_id']).','.(int)$id.','.$this->q($plan['hash']).','.$this->q($payloadHash).') ON DUPLICATE KEY UPDATE MANAGED_HASH=VALUES(MANAGED_HASH),PAYLOAD_HASH=VALUES(PAYLOAD_HASH)');
                $operation=hash('sha256',$packageHash.':'.$key);
                $this->db->queryExecute('INSERT INTO ug_operation (OPERATION_KEY,PROJECT_ID,FENCE,PACKAGE_HASH,ENTITY_KEY,RESULT,APPLIED_AT) VALUES ('.$this->q($operation).','.$this->q($this->project).','.$token.','.$this->q($packageHash).','.$this->q($key).','.$this->q($plan['action']).','.time().') ON DUPLICATE KEY UPDATE OPERATION_KEY=VALUES(OPERATION_KEY)');
                $this->fence($token,$owner); $this->db->commitTransaction();
                $summary[$plan['action']]++;
                // If this process dies here, resume re-reads the destination, not this advisory file.
                file_put_contents($checkpointDir.'/'.$operation.'.json',self::encode(['package_hash'=>$packageHash,'entity_key'=>$key,'bitrix_id'=>$id,'result'=>$plan['action'],'fence'=>$token]),LOCK_EX);
            } catch (\Throwable $error) { $this->db->rollbackTransaction(); throw $error; }
        }
        foreach (array_chunk($package['routes'],100) as $batch) {
            $this->db->startTransaction();
            try {
                $this->fence($token,$owner);
                foreach ($batch as $route) {
                    $this->db->queryExecute('INSERT INTO ug_route (ROUTE_KEY,PROJECT_ID,REQUEST_TARGET,ENTITY_KEY,STATUS,REDIRECT_TARGET) VALUES ('.$this->q($route['route_key']).','.$this->q($this->project).','.$this->q($route['request_target']).','.($route['entity_key']?$this->q($route['entity_key']):'NULL').','.(int)$route['expected_status'].','.($route['redirect_target']?$this->q($route['redirect_target']):'NULL').') ON DUPLICATE KEY UPDATE REQUEST_TARGET=VALUES(REQUEST_TARGET),ENTITY_KEY=VALUES(ENTITY_KEY),STATUS=VALUES(STATUS),REDIRECT_TARGET=VALUES(REDIRECT_TARGET)');
                    $summary['routes']++;
                }
                $this->fence($token,$owner); $this->db->commitTransaction();
            } catch (\Throwable $error) { $this->db->rollbackTransaction(); throw $error; }
        }
        foreach ($package['entities'] as $entity) { $current=$this->current($entity['stable_key']); if ($current) { \CIBlockElement::UpdateSearch($current['id'],true); } }
        \CIBlock::clearIblockTagCache($this->iblock);
        $summary['verification']=$this->reconcile($package);
        return $summary;
    }
    public function reconcile(array $package): array
    {
        $this->assetIndex=$package['asset_index'];
        $defects=[];
        foreach ($package['entities'] as $entity) {
            try { $plan=$this->planEntity($entity); if (!in_array($plan['action'],['skipped','reconciled'],true)) { $defects[]=['entity'=>$entity['source_id'],'status'=>$plan['action']]; } }
            catch (\Throwable $error) { $defects[]=['entity'=>$entity['source_id'],'reason'=>$error->getMessage()]; }
        }
        foreach ($package['routes'] as $expected) {
            $actual=$this->db->query('SELECT * FROM ug_route WHERE PROJECT_ID='.$this->q($this->project).' AND ROUTE_KEY='.$this->q($expected['route_key']))->fetch();
            if (!$actual || $actual['REQUEST_TARGET']!==$expected['request_target'] || (int)$actual['STATUS']!==$expected['expected_status'] || ($actual['ENTITY_KEY']??null)!==$expected['entity_key'] || ($actual['REDIRECT_TARGET']??null)!==$expected['redirect_target']) { $defects[]=['route'=>$expected['request_target'],'reason'=>'ROUTE_MISMATCH']; }
        }
        foreach ($package['assets'] as $asset) { $file=$_SERVER['DOCUMENT_ROOT'].$asset['public_path']; if (!is_file($file)||!hash_equals($asset['sha256'],(string)hash_file('sha256',$file))) { $defects[]=['asset'=>$asset['sha256'],'reason'=>'ASSET_MISMATCH']; } }
        $known=array_map(static fn($asset)=>basename($asset['path']),$package['assets']);
        $orphans=[]; foreach (glob($_SERVER['DOCUMENT_ROOT'].'/upload/upgrade/'.$this->project.'/*')?:[] as $file) { if (!in_array(basename($file),$known,true)) { $orphans[]=basename($file); } }
        return ['status'=>$defects?'FAIL':'DATABASE_RECONCILED','defects'=>$defects,'unreferenced_files'=>$orphans,'http_browser_admin'=>'NOT_RUN'];
    }
}
