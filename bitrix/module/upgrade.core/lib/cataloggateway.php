<?php
declare(strict_types=1);
namespace Upgrade\Core;
require_once __DIR__.'/factsproperty.php';

final class CatalogError extends \RuntimeException {}

/** Native implementation below uses only documented catalog/iblock APIs for CMS data. */
interface CatalogTargetPort
{
    public function begin(): void;
    public function commit(): void;
    public function rollback(): void;
    public function fence(int $fence, string $owner): void;
    public function read(array $item): array;
    public function matches(array $item, array $actual): bool;
    public function recoverable(array $item, array $before, array $actual): bool;
    public function unowned(array $item, array $actual): bool;
    public function write(array $item, array $before): void;
}

final class CatalogGateway
{
    private string $directory;
    public function __construct(private CatalogTargetPort $port, private array $projection, private array $profile, string $stateDirectory)
    {
        self::validate($projection,$profile);
        self::need(is_dir($stateDirectory)&&!is_link($stateDirectory),'CATALOG_PRIVATE_STATE_REQUIRED');
        $this->directory=$stateDirectory.'/catalog-'.$projection['project_id'];
        if (!is_dir($this->directory)) self::need(mkdir($this->directory,0700),'CATALOG_STATE_CREATE_FAILED');
        self::need(!is_link($this->directory)&&is_dir($this->directory),'CATALOG_STATE_UNSAFE');
    }
    public static function need(bool $ok,string $code): void { if (!$ok) throw new CatalogError($code); }
    public static function encode(mixed $v): string { return json_encode($v,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); }
    private static function sourceKey(array $parts): string{return hash('sha256',json_encode($parts,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_LINE_TERMINATORS|JSON_THROW_ON_ERROR));}
    private static function canonical(mixed $v): mixed { if(!is_array($v))return $v;if(!array_is_list($v))ksort($v,SORT_STRING);foreach($v as $k=>$x)$v[$k]=self::canonical($x);return $v; }
    public static function digest(mixed $v): string { return hash('sha256',self::encode(self::canonical($v))); }
    private static function sha(mixed $v): bool { return is_string($v)&&preg_match('/^[a-f0-9]{64}$/D',$v)===1; }
    private static function evidence(mixed $e): bool { return is_array($e)&&($e['trust']??null)==='untrusted-source-data'&&self::sha($e['snapshot_sha256']??null)&&is_string($e['locator']??null)&&$e['locator']!==''&&is_string($e['source_url']??null)&&preg_match('~^https?://~',$e['source_url'])===1&&is_string($e['observed_at']??null)&&strtotime($e['observed_at'])!==false; }
    private static function quantity(mixed $s): bool { return is_string($s)&&preg_match('/^(0|[1-9]\d{0,6})(?:\.\d{1,6})?$/D',$s)===1&&self::scaled($s)>0&&self::scaled($s)<=1000000000000; }
    private static function scaled(string $s): int { $p=explode('.',$s);return (int)$p[0]*1000000+(int)str_pad($p[1]??'',6,'0'); }
    private static function fact(mixed $v): ?string{return is_array($v)&&($v['status']??null)==='OBSERVED'&&is_string($v['value']??null)&&$v['value']!==''&&self::evidence($v['evidence']??null)?$v['value']:null;}
    private static function factualMetadata(array $v,array $source): void{$attrs=[];foreach($source['attributes']??[] as $key=>$f){$value=self::fact($f);if($value!==null)$attrs[$key]=$value;}self::need(($v['sku']??null)===self::fact($source['sku']??null)&&self::digest($v['attributes']??null)===self::digest($attrs)&&strlen(self::encode([$v['sku']??null,$attrs]))<=50000,'CATALOG_METADATA_SOURCE_MISMATCH');}
    private static function price(mixed $p,array $observation,string $sourceUrl): void
    {
        if($p===null)return;
        self::need(($p['evidence']['source_url']??null)===$sourceUrl&&($p['quantity_evidence']['source_url']??null)===$sourceUrl,'CATALOG_PRICE_SOURCE_PAGE_MISMATCH');
        self::need(is_array($p)&&is_string($p['decimal']??null)&&preg_match('/^(0|[1-9]\d{0,10})(?:\.\d{1,2})?$/D',$p['decimal'])===1&&in_array($p['currency']??null,['RUB','USD','EUR'],true)&&is_int($p['minor']??null)&&$p['minor']>=0,'CATALOG_PRICE_MONEY_INVALID');
        $parts=explode('.',$p['decimal']);self::need((int)$parts[0]*100+(int)str_pad($parts[1]??'',2,'0')===$p['minor'],'CATALOG_PRICE_MINOR_MISMATCH');
        self::need(is_string($p['unit']??null)&&preg_match('/^[a-zA-Z0-9_-]{1,32}$/D',$p['unit'])===1&&self::quantity($p['min_quantity']??null)&&self::quantity($p['quantity_step']??null)&&(($p['max_quantity']??null)===null||self::quantity($p['max_quantity']))&&self::evidence($p['evidence']??null)&&self::evidence($p['quantity_evidence']??null),'CATALOG_PRICE_EVIDENCE_INVALID');
        self::need(self::scaled($p['min_quantity'])%self::scaled($p['quantity_step'])===0&&($p['max_quantity']===null||self::scaled($p['max_quantity'])>=self::scaled($p['min_quantity'])),'CATALOG_QUANTITY_INVALID');
        $prices=array_values(array_filter($observation['prices']??[],static fn($x)=>($x['id']??null)===($p['source_price_id']??null)));
        self::need(count($prices)===1,'CATALOG_PRICE_SOURCE_MISMATCH');$s=$prices[0];$q=$observation['purchase']??[];
        self::need(($s['role']??null)==='CURRENT'&&($s['status']??null)==='OBSERVED'&&($s['totals_eligible']??null)===true&&($s['maximum']??null)===null&&($s['conditions']??null)===[]&&($q['blockers']??null)===[]&&($q['price_id']??null)===$p['source_price_id'],'CATALOG_PRICE_NOT_ELIGIBLE');
        foreach(['decimal','currency','minor'] as $k)self::need(($s['money'][$k]??null)===$p[$k],'CATALOG_PRICE_SOURCE_MISMATCH');
        foreach(['min_quantity','quantity_step','max_quantity','quantity_evidence'] as $k)self::need(self::digest($q[$k]??null)===self::digest($p[$k]),'CATALOG_QUANTITY_SOURCE_MISMATCH');
        self::need(($s['unit']??null)===$p['unit']&&self::digest($s['evidence'])===self::digest($p['evidence']),'CATALOG_PRICE_SOURCE_MISMATCH');
    }
    public static function validate(array $p,array $profile): void
    {
        self::need(($p['schema_version']??null)===1&&($p['kind']??null)==='native-catalog-overlay'&&($p['state']??null)==='PARTIAL'&&($p['runtime_verification']??null)==='NOT_RUN','CATALOG_SCHEMA_INVALID');
        self::need(is_string($p['project_id']??null)&&preg_match('/^[a-zA-Z0-9_-]{1,63}$/D',$p['project_id'])===1&&is_string($p['target_id']??null)&&preg_match('/^[a-zA-Z0-9_.-]{1,128}$/D',$p['target_id'])===1&&self::sha($p['content_manifest_sha256']??null)&&self::sha($p['model_sha256']??null),'CATALOG_BINDING_INVALID');
        self::need(($profile['schema_version']??null)===1&&($profile['project_id']??null)===$p['project_id']&&($profile['target_id']??null)===$p['target_id']&&($profile['sale_policy']??null)==='isolated-demo-no-orders','CATALOG_PROFILE_BINDING_INVALID');
        foreach(['product_iblock_id','offers_iblock_id','sku_property_id','product_metadata_property_id','offer_metadata_property_id','price_group_id'] as $k)self::need(is_int($profile[$k]??null)&&$profile[$k]>0,'CATALOG_PROFILE_ID_INVALID');
        self::need($profile['product_iblock_id']!==$profile['offers_iblock_id']&&is_array($profile['measures']??null),'CATALOG_PROFILE_INVALID');
        foreach($profile['measures'] as $unit=>$measure) self::need(is_string($unit)&&is_array($measure)&&is_int($measure['id']??null)&&$measure['id']>0&&is_int($measure['code']??null)&&$measure['code']>0,'CATALOG_MEASURE_INVALID');
        self::need(is_array($p['products']??null)&&array_is_list($p['products'])&&count($p['products'])<=20000&&is_array($p['categories']??null)&&array_is_list($p['categories'])&&count($p['categories'])<=20000&&($p['blockers']??null)===[],'CATALOG_SCOPE_INVALID');
        $keys=[];$sources=[];$categoryKeys=[];
        foreach(array_merge($p['products'],$p['categories']) as $item){$r=$item['page']??[];self::need(self::sha($r['stable_key']??null)&&self::sha($r['payload_sha256']??null)&&is_string($r['source_id']??null)&&strlen($r['source_id'])>0&&strlen($r['source_id'])<=8192&&is_string($r['source_url']??null)&&preg_match('~^https?://~',$r['source_url'])===1&&is_string($r['title']??null)&&strlen($r['title'])>0&&strlen($r['title'])<=2000,'CATALOG_PAGE_REFERENCE_INVALID');self::need(!isset($keys[$r['stable_key']])&&!isset($sources[$r['source_id']]),'CATALOG_DUPLICATE_PAGE');$keys[$r['stable_key']]=true;$sources[$r['source_id']]=true;}
        foreach($p['categories'] as $c){self::need(($c['category_key']??null)===self::sourceKey([$p['project_id'],'category',$c['page']['source_id']])&&is_string($c['name']??null)&&$c['name']!==''&&strlen($c['name'])<=255&&self::evidence($c['evidence']??null),'CATALOG_CATEGORY_INVALID');$co=$c['observation']??[];self::need(($co['entity_source_id']??null)===$c['page']['source_id']&&($co['source_url']??null)===$c['page']['source_url']&&($co['page_kind']['status']??null)==='OBSERVED'&&($co['page_kind']['value']??null)==='CATEGORY'&&self::evidence($co['page_kind']['evidence']??null),'CATALOG_CATEGORY_NOT_OBSERVED');$categoryKeys[$c['category_key']]=true;}
        foreach($p['products'] as $product){$o=$product['observation']??[];self::need(($o['entity_source_id']??null)===$product['page']['source_id']&&($o['source_url']??null)===$product['page']['source_url']&&($o['page_kind']['status']??null)==='OBSERVED'&&($o['page_kind']['value']??null)==='PRODUCT'&&self::evidence($o['page_kind']['evidence']??null),'CATALOG_OBSERVATION_BINDING');self::need(is_array($product['category_keys']??null)&&count(array_unique($product['category_keys']))===count($product['category_keys']),'CATALOG_CATEGORY_MEMBERSHIP');foreach($product['category_keys'] as $k)self::need(isset($categoryKeys[$k]),'CATALOG_CATEGORY_MEMBERSHIP');
            self::need(($o['page_kind']['evidence']['source_url']??null)===$product['page']['source_url'],'CATALOG_KIND_EVIDENCE_PAGE_MISMATCH');$facts=array_merge([$o['product']['sku']??null],array_values($o['product']['attributes']??[]));foreach($o['variants']??[] as $variant){self::need(($variant['evidence']['source_url']??null)===$product['page']['source_url'],'CATALOG_VARIANT_EVIDENCE_PAGE_MISMATCH');$facts=array_merge($facts,[$variant['sku']??null],array_values($variant['attributes']??[]));}foreach($facts as $fact)if(($fact['status']??null)==='OBSERVED')self::need(self::evidence($fact['evidence']??null)&&$fact['evidence']['source_url']===$product['page']['source_url'],'CATALOG_FACT_EVIDENCE_PAGE_MISMATCH');self::factualMetadata($product,$o['product']??[]);self::price($product['price']??null,$o,$product['page']['source_url']);$offers=$product['offers']??null;self::need(is_array($offers)&&array_is_list($offers)&&count($offers)<=200&&count($offers)===count($o['variants']??[]),'CATALOG_OFFER_SET_INVALID');self::need(!$offers||($product['price']??null)===null,'CATALOG_PARENT_PRICE_WITH_OFFERS');$seen=[];
            foreach(array_merge([$product],$offers) as $node)if(($node['price']??null)!==null)self::need(isset($profile['measures'][$node['price']['unit']]),'CATALOG_MEASURE_NOT_MAPPED');
            foreach($offers as $v){$id=$v['observed_variant_id']??null;self::need(is_string($id)&&$id!==''&&!isset($seen[$id])&&($v['offer_key']??null)===self::sourceKey([$p['project_id'],'offer',$product['page']['source_id'],$id]),'CATALOG_OFFER_ID_INVALID');$seen[$id]=true;$matches=array_values(array_filter($o['variants'],static fn($x)=>($x['id']??null)===$id));self::need(count($matches)===1&&self::evidence($v['evidence']??null)&&self::digest($v['evidence'])===self::digest($matches[0]['evidence']??null)&&($v['source_url']??null)===($matches[0]['source_url']??null),'CATALOG_OFFER_EVIDENCE');self::factualMetadata($v,$matches[0]);$attrs=$v['attributes']??null;self::need(is_array($attrs)&&count($attrs)>0&&count($attrs)===count($matches[0]['attributes']??[]),'CATALOG_OFFER_ATTRIBUTES');foreach($attrs as $key=>$value){$a=$matches[0]['attributes'][$key]??[];self::need(is_string($value)&&($a['status']??null)==='OBSERVED'&&($a['value']??null)===$value&&self::evidence($a['evidence']??null),'CATALOG_OFFER_ATTRIBUTES');}self::need(strlen(implode(' / ',array_map(static fn($k,$v)=>$k.': '.$v,array_keys($attrs),array_values($attrs))))<=255,'CATALOG_OFFER_NAME_TOO_LONG');self::price($v['price']??null,$matches[0],$product['page']['source_url']);}
        }
    }
    private function items(): array { return array_merge(array_map(static fn($c)=>['kind'=>'category','key'=>$c['category_key'],'value'=>$c],$this->projection['categories']),array_map(static fn($p)=>['kind'=>'product','key'=>$p['page']['stable_key'],'value'=>$p],$this->projection['products'])); }
    private function path(array $item): string { return $this->directory.'/'.$item['key'].'.json'; }
    private function checkpointScope(): array
    {
        $selected=array_fill_keys(array_column($this->items(),'key'),true);$names=scandir($this->directory);self::need(is_array($names)&&count($names)<=100002,'CATALOG_CHECKPOINT_INVENTORY_FAILED');$retained=[];$pending=[];
        foreach($names as $name){if($name==='.'||$name==='..')continue;$path=$this->directory.'/'.$name;self::need(is_file($path)&&!is_link($path),'CATALOG_CHECKPOINT_INVENTORY_UNSAFE');if(preg_match('/^[a-f0-9]{64}\.json\.pending-[a-f0-9]{16}$/D',$name)===1){$pending[]=$name;continue;}self::need(preg_match('/^([a-f0-9]{64})\.json$/D',$name,$m)===1,'CATALOG_CHECKPOINT_INVENTORY_UNEXPECTED');if(!isset($selected[$m[1]])){$r=$this->record(['key'=>$m[1]]);$retained[]=['key'=>$m[1],'state'=>$r['state']];}}
        return ['selection'=>'supplied-overlay-only','products'=>count($this->projection['products']),'offers'=>array_sum(array_map(static fn($p)=>count($p['offers']),$this->projection['products'])),'categories'=>count($this->projection['categories']),'retained_outside_projection'=>$retained,'incomplete_checkpoint_files'=>$pending,'full_source_denominator'=>'UNKNOWN'];
    }
    private function binding(array $item): array { return ['project_id'=>$this->projection['project_id'],'target_id'=>$this->projection['target_id'],'key'=>$item['key'],'profile_sha256'=>self::digest($this->profile)]; }
    private function record(array $item): ?array
    {
        $path=$this->path($item);if(!file_exists($path)&&!is_link($path))return null;
        self::need(is_file($path)&&!is_link($path)&&filesize($path)<=16777216,'CATALOG_CHECKPOINT_UNSAFE');$raw=file_get_contents($path);self::need(is_string($raw),'CATALOG_CHECKPOINT_READ_FAILED');$r=json_decode($raw,true,64,JSON_THROW_ON_ERROR);
        self::need(is_array($r)&&isset($r['checksum']),'CATALOG_CHECKPOINT_CORRUPT');$checksum=$r['checksum'];unset($r['checksum']);self::need(self::sha($checksum)&&hash_equals($checksum,self::digest($r))&&($r['schema_version']??null)===1&&($r['binding']??null)===$this->binding($item)&&in_array($r['state']??null,['PENDING','COMMITTED'],true)&&self::sha($r['input_hash']??null)&&is_array($r['before']??null),'CATALOG_CHECKPOINT_CORRUPT');
        if($r['state']==='COMMITTED')self::need(is_array($r['after']??null),'CATALOG_CHECKPOINT_CORRUPT');return $r;
    }
    private function save(array $item,array $record): void
    {
        $record['checksum']=self::digest($record);$raw=self::encode($record);self::need(strlen($raw)<=16777216,'CATALOG_CHECKPOINT_TOO_LARGE');$path=$this->path($item);$pending=$path.'.pending-'.bin2hex(random_bytes(8));$h=fopen($pending,'xb');self::need(is_resource($h),'CATALOG_CHECKPOINT_CREATE_FAILED');chmod($pending,0600);
        try{self::need(fwrite($h,$raw)===strlen($raw)&&fflush($h)&&fsync($h),'CATALOG_CHECKPOINT_DURABILITY_FAILED');}finally{fclose($h);}self::need(!is_link($path)&&rename($pending,$path),'CATALOG_CHECKPOINT_RENAME_FAILED');
        if(PHP_OS_FAMILY!=='Windows'){$d=fopen($this->directory,'r');self::need(is_resource($d),'CATALOG_DIRECTORY_OPEN_FAILED');try{self::need(fsync($d),'CATALOG_DIRECTORY_SYNC_FAILED');}finally{fclose($d);}}
    }
    private function plan(array $item): array
    {
        $current=$this->port->read($item);$r=$this->record($item);$input=self::digest($item);
        if(!$r){self::need(!$this->port->unowned($item,$current),'CATALOG_UNOWNED_NATIVE_DATA');return ['action'=>'created','before'=>$current,'input'=>$input,'record'=>null];}
        if($r['state']==='PENDING'){
            self::need(hash_equals($r['input_hash'],$input),'CATALOG_UNKNOWN_DIFFERENT_INTENT');
            if($this->port->matches($item,$current)){self::need($this->port->recoverable($item,$r['before'],$current),'CATALOG_UNKNOWN_THIRD_VALUE');return ['action'=>'reconciled','before'=>$current,'input'=>$input,'record'=>$r];}
            self::need(self::digest($current)===self::digest($r['before']),'CATALOG_UNKNOWN_THIRD_VALUE');return ['action'=>'recovered-before-write','before'=>$current,'input'=>$input,'record'=>$r];
        }
        $comparison=$current;
        // A separately verified content import can legitimately change page prose.
        // Native identity is immutable; page() already validated the new accepted
        // payload, import operation and live managed fields before this point.
        if(!hash_equals($r['input_hash'],$input)&&isset($comparison['page'],$r['after']['page'])&&$comparison['page']['id']===$r['after']['page']['id']&&$comparison['page']['xml_id']===$r['after']['page']['xml_id'])$comparison['page']['content_hash']=$r['after']['page']['content_hash'];
        self::need(self::digest($comparison)===self::digest($r['after']),'CATALOG_USER_EDIT_CONFLICT');
        if(hash_equals($r['input_hash'],$input)){self::need($this->port->matches($item,$current),'CATALOG_READBACK_MISMATCH');return ['action'=>'skipped','before'=>$current,'input'=>$input,'record'=>$r];}
        return ['action'=>'updated','before'=>$current,'input'=>$input,'record'=>$r];
    }
    public function dryRun(): array { $scope=$this->checkpointScope();$out=['created'=>0,'updated'=>0,'skipped'=>0,'reconciled'=>0,'recovered-before-write'=>0,'conflicts'=>[],'runtime_verification'=>'NOT_RUN','scope'=>$scope,'withheld_prices'=>[]];foreach($scope['retained_outside_projection'] as $r)if($r['state']==='PENDING')$out['conflicts'][]=['key'=>$r['key'],'reason'=>'CATALOG_OUTSIDE_SCOPE_PENDING'];foreach($this->items() as $item){try{$plan=$this->plan($item);$out[$plan['action']]++;}catch(\Throwable $e){$out['conflicts'][]=['key'=>$item['key'],'reason'=>$e instanceof CatalogError?$e->getMessage():'CATALOG_READ_FAILED'];}if($item['kind']==='product'){foreach($item['value']['offers']?:[$item['value']] as $node)if($node['price']===null)$out['withheld_prices'][]=['key'=>$node['offer_key']??$item['key'],'reasons'=>$node['blockers']];}}return $out; }
    public function apply(int $fence,string $owner): array
    {
        $preflight=$this->dryRun();self::need(!$preflight['conflicts'],'CATALOG_DRY_RUN_CONFLICT:'.($preflight['conflicts'][0]['reason']??''));
        $scope=$this->checkpointScope();foreach($scope['retained_outside_projection'] as $r)self::need($r['state']!=='PENDING','CATALOG_OUTSIDE_SCOPE_PENDING');$out=['created'=>0,'updated'=>0,'skipped'=>0,'reconciled'=>0,'recovered-before-write'=>0,'scope'=>$scope];
        foreach($this->items() as $item){$this->port->begin();$committed=false;try{$this->port->fence($fence,$owner);$plan=$this->plan($item);$r=$plan['record'];if($plan['action']==='skipped'){$this->port->commit();$committed=true;$out['skipped']++;continue;}
                if($plan['action']!=='reconciled'){$r=['schema_version'=>1,'binding'=>$this->binding($item),'state'=>'PENDING','input_hash'=>$plan['input'],'before'=>$plan['before'],'content_manifest_sha256'=>$this->projection['content_manifest_sha256'],'model_sha256'=>$this->projection['model_sha256'],'fence'=>$fence,'owner'=>$owner];$this->save($item,$r);$this->port->write($item,$plan['before']);}
                $actual=$this->port->read($item);self::need($this->port->matches($item,$actual),'CATALOG_WRITE_READBACK_FAILED');$this->port->fence($fence,$owner);$this->port->commit();$committed=true;
                $r['state']='COMMITTED';$r['after']=$actual;$this->save($item,$r);$out[$plan['action']]++;
            }catch(\Throwable $e){if(!$committed){try{$this->port->rollback();}catch(\Throwable){}}throw $e;}}
        return $out;
    }
    public function reconcile(): array { $scope=$this->checkpointScope();$defects=[];$count=0;foreach($scope['retained_outside_projection'] as $r)if($r['state']==='PENDING')$defects[]=['key'=>$r['key'],'reason'=>'CATALOG_OUTSIDE_SCOPE_PENDING'];foreach($this->items() as $i){try{$p=$this->plan($i);self::need($p['action']==='skipped','CATALOG_CHECKPOINT_NOT_COMMITTED');$count++;}catch(\Throwable $e){$defects[]=['key'=>$i['key'],'reason'=>$e instanceof CatalogError?$e->getMessage():'CATALOG_READ_FAILED'];}}return ['status'=>$defects?'FAIL':'CATALOG_RECONCILED','count'=>$count,'defects'=>$defects,'scope'=>$scope,'readiness'=>'PARTIAL']; }
}

/** Only this adapter reaches a licensed Bitrix. No sale/order or mail APIs. */
final class NativeCatalogPort implements CatalogTargetPort
{
    private mixed $db;private mixed $lock;private string $project;private int $iblock;
    public function __construct(private array $profile,string $stateDirectory,private string $contentManifestSha256)
    {
        CatalogGateway::need(is_string($profile['project_id']??null)&&preg_match('/^[a-zA-Z0-9_-]{1,63}$/D',$profile['project_id'])===1&&is_int($profile['product_iblock_id']??null)&&$profile['product_iblock_id']>0,'CATALOG_PROFILE_INVALID');$this->project=$profile['project_id'];$this->iblock=$profile['product_iblock_id'];CatalogGateway::need(preg_match('/^[a-f0-9]{64}$/D',$contentManifestSha256)===1,'CATALOG_CONTENT_PIN_REQUIRED');
        CatalogGateway::need(PHP_SAPI==='cli'&&getenv('UPGRADE_DEMO')==='1'&&getenv('UPGRADE_PROJECT_ID')===$this->project&&getenv('UPGRADE_TARGET_ID')===$profile['target_id']&&defined('UPGRADE_SANDBOX_PREPEND_ACTIVE')&&UPGRADE_SANDBOX_PREPEND_ACTIVE===true,'CATALOG_CLI_SANDBOX_REQUIRED');
        CatalogGateway::need(\Bitrix\Main\Loader::includeModule('iblock')&&\Bitrix\Main\Loader::includeModule('catalog'),'CATALOG_MODULE_REQUIRED');
        CatalogGateway::need(is_dir($stateDirectory)&&!is_link($stateDirectory),'CATALOG_PRIVATE_STATE_REQUIRED');$path=$stateDirectory.'/upgrade-'.$this->project.'.lock';CatalogGateway::need(!is_link($path),'CATALOG_LOCK_UNSAFE');$this->lock=fopen($path,'c');CatalogGateway::need(is_resource($this->lock)&&flock($this->lock,LOCK_EX|LOCK_NB),'TARGET_WRITER_BUSY');
        $this->db=\Bitrix\Main\Application::getConnection();$row=$this->db->query('SELECT * FROM ug_project WHERE PROJECT_ID='.$this->q($this->project))->fetch();CatalogGateway::need($row&&(int)$row['IBLOCK_ID']===$this->iblock,'CATALOG_PROJECT_IBLOCK_MISMATCH');
        $this->verifyProfile(false);
    }
    public function __destruct(){if(is_resource($this->lock)){flock($this->lock,LOCK_UN);fclose($this->lock);}}
    private function q(string $v): string{return "'".$this->db->getSqlHelper()->forSql($v)."'";}
    public function begin(): void{$this->db->startTransaction();}public function commit(): void{$this->db->commitTransaction();}public function rollback(): void{$this->db->rollbackTransaction();}
    public function fence(int $fence,string $owner): void{$r=$this->db->query('SELECT FENCE,OWNER,LEASE_UNTIL FROM ug_project WHERE PROJECT_ID='.$this->q($this->project).' FOR UPDATE')->fetch();CatalogGateway::need($r&&(int)$r['FENCE']===$fence&&$r['OWNER']===$owner&&(int)$r['LEASE_UNTIL']>time(),'STALE_TARGET_FENCE');}
    public function claim(string $owner,int $ttl=3600): array
    {
        CatalogGateway::need(preg_match('/^[a-zA-Z0-9_.-]{1,128}$/D',$owner)===1&&$ttl>=30&&$ttl<=3600,'INVALID_OWNER_OR_TTL');$this->begin();try{$r=$this->db->query('SELECT FENCE,OWNER,LEASE_UNTIL FROM ug_project WHERE PROJECT_ID='.$this->q($this->project).' FOR UPDATE')->fetch();CatalogGateway::need($r&&((int)$r['LEASE_UNTIL']<=time()||$r['OWNER']===$owner),'TARGET_LEASE_ACTIVE');$f=(int)$r['FENCE']+1;$until=time()+$ttl;$this->db->queryExecute('UPDATE ug_project SET FENCE='.$f.',OWNER='.$this->q($owner).',LEASE_UNTIL='.$until.' WHERE PROJECT_ID='.$this->q($this->project));$this->commit();return ['fence'=>$f,'owner'=>$owner,'lease_until'=>$until];}catch(\Throwable $e){$this->rollback();throw $e;}
    }
    private function verifyProfile(bool $registered): void
    {
        $product=\CIBlock::GetByID($this->iblock)->Fetch();$offers=\CIBlock::GetByID($this->profile['offers_iblock_id'])->Fetch();$prop=\CIBlockProperty::GetByID($this->profile['sku_property_id'],$this->profile['offers_iblock_id'])->Fetch();
        CatalogGateway::need($product&&$product['XML_ID']==='upgrade:'.$this->project&&$offers&&$offers['XML_ID']==='upgrade:offers:'.$this->project,'CATALOG_IBLOCK_IDENTITY_MISMATCH');
        CatalogGateway::need($prop&&$prop['PROPERTY_TYPE']==='E'&&(int)$prop['LINK_IBLOCK_ID']===$this->iblock&&$prop['MULTIPLE']==='N'&&$prop['CODE']==='CML2_LINK','CATALOG_SKU_PROPERTY_MISMATCH');
        foreach([[$this->iblock,$this->profile['product_metadata_property_id']],[$this->profile['offers_iblock_id'],$this->profile['offer_metadata_property_id']]] as [$iblock,$property]){$r=\CIBlockProperty::GetByID($property,$iblock)->Fetch();CatalogGateway::need($r&&$r['PROPERTY_TYPE']==='S'&&$r['MULTIPLE']==='N'&&$r['CODE']==='UG_CATALOG_DATA','CATALOG_METADATA_PROPERTY_MISMATCH');}
        CatalogGateway::need((bool)\Bitrix\Catalog\GroupTable::getList(['filter'=>['=ID'=>$this->profile['price_group_id']],'limit'=>1])->fetch(),'CATALOG_PRICE_GROUP_MISSING');
        foreach($this->profile['measures'] as $m){$r=\Bitrix\Catalog\MeasureTable::getList(['filter'=>['=ID'=>$m['id']],'limit'=>1])->fetch();CatalogGateway::need($r&&(int)$r['CODE']===$m['code'],'CATALOG_MEASURE_BINDING_MISMATCH');}
        if($registered){$parent=\CCatalog::GetByID($this->iblock);$r=\CCatalog::GetByID($this->profile['offers_iblock_id']);CatalogGateway::need($parent&&(int)($parent['PRODUCT_IBLOCK_ID']??0)===0&&$r&&(int)$r['PRODUCT_IBLOCK_ID']===$this->iblock&&(int)$r['SKU_PROPERTY_ID']===$this->profile['sku_property_id'],'CATALOG_REGISTRATION_MISMATCH');}
    }
    public function setup(int $fence,string $owner): array
    {
        $this->begin();try{$this->fence($fence,$owner);$this->verifyProfile(false);$r=\CCatalog::GetByID($this->iblock);if(!$r)CatalogGateway::need((bool)\CCatalog::Add(['IBLOCK_ID'=>$this->iblock,'YANDEX_EXPORT'=>'N','SUBSCRIPTION'=>'N']),'CATALOG_REGISTER_FAILED');
            $r=\CCatalog::GetByID($this->profile['offers_iblock_id']);if(!$r)CatalogGateway::need((bool)\CCatalog::Add(['IBLOCK_ID'=>$this->profile['offers_iblock_id'],'PRODUCT_IBLOCK_ID'=>$this->iblock,'SKU_PROPERTY_ID'=>$this->profile['sku_property_id'],'YANDEX_EXPORT'=>'N','SUBSCRIPTION'=>'N']),'CATALOG_OFFERS_REGISTER_FAILED');$this->verifyProfile(true);$this->fence($fence,$owner);$this->commit();return ['status'=>'CATALOG_PROFILE_REGISTERED','profile'=>$this->profile];}catch(\Throwable $e){$this->rollback();throw $e;}
    }
    private static function rows(mixed $result): array{$out=[];while($r=$result->Fetch())$out[]=$r;return $out;}
    private function page(array $ref): array
    {
        $m=$this->db->query('SELECT * FROM ug_entity WHERE PROJECT_ID='.$this->q($this->project).' AND ENTITY_KEY='.$this->q($ref['stable_key']))->fetch();CatalogGateway::need($m&&$m['SOURCE_ID']===$ref['source_id']&&hash_equals($ref['payload_sha256'],$m['PAYLOAD_HASH']),'CATALOG_PAGE_MAPPING_MISMATCH');
        $op=$this->db->query('SELECT OPERATION_KEY FROM ug_operation WHERE PROJECT_ID='.$this->q($this->project).' AND ENTITY_KEY='.$this->q($ref['stable_key']).' AND PACKAGE_HASH='.$this->q($this->contentManifestSha256))->fetch();CatalogGateway::need((bool)$op,'CATALOG_CONTENT_IMPORT_NOT_CONFIRMED');
        $r=\CIBlockElement::GetByID((int)$m['BITRIX_ID'])->Fetch();CatalogGateway::need($r&&(int)$r['IBLOCK_ID']===$this->iblock&&$r['XML_ID']==='upgrade:'.$ref['stable_key'],'CATALOG_PAGE_IDENTITY_MISMATCH');
        $properties=[];foreach(['UG_SEO_TITLE','UG_DESCRIPTION','UG_H1','UG_FACTS'] as $code){$value=\CIBlockElement::GetProperty($this->iblock,(int)$r['ID'],[],['CODE'=>$code])->Fetch();$properties[$code]=(string)($value['VALUE']??'');if($code==='UG_FACTS')$properties[$code]=FactsProperty::decode($properties[$code]);}
        $managed=['NAME'=>(string)$r['NAME'],'DETAIL_TEXT'=>(string)$r['DETAIL_TEXT'],'DETAIL_TEXT_TYPE'=>(string)$r['DETAIL_TEXT_TYPE'],'PREVIEW_TEXT'=>(string)$r['PREVIEW_TEXT'],'PREVIEW_TEXT_TYPE'=>(string)$r['PREVIEW_TEXT_TYPE'],'properties'=>$properties];
        CatalogGateway::need(isset($m['MANAGED_HASH'])&&hash_equals($m['MANAGED_HASH'],hash('sha256',CatalogGateway::encode($managed))),'CATALOG_PAGE_CONTENT_DRIFT');return ['id'=>(int)$r['ID'],'xml_id'=>$r['XML_ID'],'content_hash'=>CatalogGateway::digest(['active'=>(string)$r['ACTIVE'],'managed'=>$managed])];
    }
    private function section(string $key): ?array{$rows=self::rows(\CIBlockSection::GetList([],['IBLOCK_ID'=>$this->iblock,'=XML_ID'=>'upgrade:category:'.$key],false,['ID','NAME','XML_ID','ACTIVE','IBLOCK_SECTION_ID']));CatalogGateway::need(count($rows)<=1,'CATALOG_DUPLICATE_CATEGORY');if(!$rows)return null;$r=$rows[0];return ['id'=>(int)$r['ID'],'name'=>(string)$r['NAME'],'xml_id'=>(string)$r['XML_ID'],'active'=>(string)$r['ACTIVE'],'parent_id'=>(int)($r['IBLOCK_SECTION_ID']??0)];}
    private function data(int $id): array
    {
        $r=\Bitrix\Catalog\ProductTable::getList(['filter'=>['=ID'=>$id],'select'=>['ID','TYPE','QUANTITY','QUANTITY_RESERVED','QUANTITY_TRACE','CAN_BUY_ZERO','SUBSCRIBE','AVAILABLE','MEASURE'],'limit'=>1])->fetch();
        if($r){foreach(['ID','TYPE','MEASURE'] as $k)$r[$k]=(int)$r[$k];foreach(['QUANTITY','QUANTITY_RESERVED'] as $k)$r[$k]=self::decimal((string)$r[$k]);}
        $prices=self::rows(\Bitrix\Catalog\PriceTable::getList(['filter'=>['=PRODUCT_ID'=>$id],'order'=>['ID'=>'ASC'],'select'=>['ID','PRODUCT_ID','CATALOG_GROUP_ID','PRICE','CURRENCY','QUANTITY_FROM','QUANTITY_TO']]));foreach($prices as &$p){foreach(['ID','PRODUCT_ID','CATALOG_GROUP_ID'] as $k)$p[$k]=(int)$p[$k];$p['PRICE']=self::decimal((string)$p['PRICE']);}unset($p);
        $ratios=self::rows(\Bitrix\Catalog\MeasureRatioTable::getList(['filter'=>['=PRODUCT_ID'=>$id],'order'=>['ID'=>'ASC'],'select'=>['ID','PRODUCT_ID','RATIO','IS_DEFAULT']]));foreach($ratios as &$ratio){$ratio['ID']=(int)$ratio['ID'];$ratio['PRODUCT_ID']=(int)$ratio['PRODUCT_ID'];$ratio['RATIO']=self::decimal((string)$ratio['RATIO']);}unset($ratio);
        return ['product'=>$r?:null,'prices'=>$prices,'ratios'=>$ratios];
    }
    public static function decimal(string $value): string {CatalogGateway::need(preg_match('/^-?\d+(?:\.\d+)?$/D',$value)===1,'CATALOG_NATIVE_DECIMAL_INVALID');if(str_contains($value,'.'))$value=rtrim(rtrim($value,'0'),'.');return $value==='-0'?'0':$value;}
    private function metadata(int $iblock,int $id,int $property): ?string{$rows=self::rows(\CIBlockElement::GetProperty($iblock,$id,[],['ID'=>$property]));CatalogGateway::need(count($rows)<=1,'CATALOG_METADATA_AMBIGUOUS');$value=$rows[0]['VALUE']??null;return $value===null||$value===false||$value===''?null:(string)$value;}
    private static function desiredMetadata(array $v): string{$attrs=$v['attributes']??[];ksort($attrs,SORT_STRING);$raw=CatalogGateway::encode(['schema_version'=>1,'sku'=>$v['sku']??null,'attributes'=>(object)$attrs,'purchase'=>$v['price']?['min_quantity'=>$v['price']['min_quantity'],'quantity_step'=>$v['price']['quantity_step'],'max_quantity'=>$v['price']['max_quantity']]:null,'stock_status'=>'UNKNOWN','sale_policy'=>'isolated-demo-no-orders']);CatalogGateway::need(strlen($raw)<=60000,'CATALOG_METADATA_TOO_LARGE');return $raw;}
    public function read(array $item): array
    {
        $this->verifyProfile(true);$v=$item['value'];$page=$this->page($v['page']);if($item['kind']==='category')return ['page'=>$page,'section'=>$this->section($item['key'])];
        $sections=array_map(static fn($r)=>(int)$r['ID'],self::rows(\CIBlockElement::GetElementGroups($page['id'],true,['ID'])));sort($sections,SORT_NUMERIC);$offers=[];
        $prop=\CIBlockProperty::GetByID($this->profile['sku_property_id'],$this->profile['offers_iblock_id'])->Fetch();
        $rows=self::rows(\CIBlockElement::GetList([],['IBLOCK_ID'=>$this->profile['offers_iblock_id'],'PROPERTY_'.$prop['CODE']=>$page['id']],false,false,['ID','XML_ID','NAME','ACTIVE']));
        foreach($rows as $r){$key=(string)$r['XML_ID'];CatalogGateway::need(!isset($offers[$key]),'CATALOG_DUPLICATE_OFFER_XML_ID');$offers[$key]=['element'=>['id'=>(int)$r['ID'],'xml_id'=>$key,'name'=>(string)$r['NAME'],'active'=>(string)$r['ACTIVE'],'parent_id'=>$page['id']],'metadata'=>$this->metadata($this->profile['offers_iblock_id'],(int)$r['ID'],$this->profile['offer_metadata_property_id'])]+$this->data((int)$r['ID']);}ksort($offers,SORT_STRING);
        return ['page'=>$page,'sections'=>$sections,'offers'=>$offers,'metadata'=>$this->metadata($this->iblock,$page['id'],$this->profile['product_metadata_property_id'])]+$this->data($page['id']);
    }
    public function unowned(array $item,array $actual): bool {return $item['kind']==='category'?$actual['section']!==null:$actual['product']!==null||$actual['metadata']!==null||count($actual['prices'])>0||count($actual['ratios'])>0||count($actual['offers'])>0||count($actual['sections'])>0;}
    public function recoverable(array $item,array $before,array $actual): bool
    {
        if(CatalogGateway::digest($before['page'])!==CatalogGateway::digest($actual['page']))return false;if($item['kind']==='category')return $before['section']===null||$before['section']['id']===$actual['section']['id'];
        $pairs=[[$before,$actual]];foreach($actual['offers'] as $key=>$value){$old=$before['offers'][$key]??['product'=>null];if(isset($old['element'])&&$old['element']['id']!==$value['element']['id'])return false;$pairs[]=[$old,$value];}
        foreach($pairs as [$a,$b]){foreach(['QUANTITY','QUANTITY_RESERVED'] as $field){$expected=$a['product'][$field]??'0';if(($b['product'][$field]??null)!==$expected)return false;}foreach(['prices','ratios'] as $table){foreach($a[$table]??[] as $old){$matching=array_values(array_filter($b[$table],static fn($row)=>$row['ID']===$old['ID']&&$row['PRODUCT_ID']===$old['PRODUCT_ID']));if(count($matching)!==1)return false;}}}return true;
    }
    private function wantedSections(array $v): array{$ids=[];foreach($v['category_keys'] as $key){$s=$this->section($key);CatalogGateway::need($s!==null,'CATALOG_CATEGORY_NOT_APPLIED');$ids[]=$s['id'];}sort($ids,SORT_NUMERIC);return $ids;}
    private function nodeMatches(array $node,int $type,?array $price): bool
    {
        $p=$node['product'];if(!$p||$p['TYPE']!==$type||$p['QUANTITY_TRACE']!=='Y'||$p['CAN_BUY_ZERO']!=='N'||$p['SUBSCRIBE']!=='N')return false;
        if(!$price)return count($node['prices'])===0;
        if(!isset($this->profile['measures'][$price['unit']])||$p['MEASURE']!==$this->profile['measures'][$price['unit']]['id']||count($node['prices'])!==1||count($node['ratios'])!==1)return false;
        $x=$node['prices'][0];$r=$node['ratios'][0];return $x['CATALOG_GROUP_ID']===$this->profile['price_group_id']&&$x['PRICE']===self::decimal($price['decimal'])&&$x['CURRENCY']===$price['currency']&&$x['QUANTITY_FROM']===null&&$x['QUANTITY_TO']===null&&$r['RATIO']===self::decimal($price['quantity_step'])&&$r['IS_DEFAULT']==='Y';
    }
    private static function offerName(array $v): string{$attrs=$v['attributes'];ksort($attrs,SORT_STRING);return implode(' / ',array_map(static fn($key,$value)=>$key.': '.$value,array_keys($attrs),array_values($attrs)));}
    public function matches(array $item,array $actual): bool
    {
        $v=$item['value'];if($item['kind']==='category')return $actual['section']!==null&&$actual['section']['name']===$v['name']&&$actual['section']['active']==='Y'&&$actual['section']['parent_id']===0;
        if($actual['sections']!==$this->wantedSections($v)||$actual['metadata']!==self::desiredMetadata($v)||!$this->nodeMatches($actual,$v['offers']?\Bitrix\Catalog\ProductTable::TYPE_SKU:\Bitrix\Catalog\ProductTable::TYPE_PRODUCT,$v['price']))return false;
        if(count($v['offers'])!==count($actual['offers']))return false;foreach($v['offers'] as $offer){$a=$actual['offers']['upgrade:offer:'.$offer['offer_key']]??null;if(!$a||$a['element']['name']!==self::offerName($offer)||$a['element']['active']!=='Y'||$a['metadata']!==self::desiredMetadata($offer)||!$this->nodeMatches($a,\Bitrix\Catalog\ProductTable::TYPE_OFFER,$offer['price']))return false;}return true;
    }
    private static function result(mixed $r,string $code): void{CatalogGateway::need(is_object($r)&&method_exists($r,'isSuccess')&&$r->isSuccess(),$code);}
    private function writeNode(int $id,int $type,?array $price,array $before): void
    {
        $fields=['TYPE'=>$type,'QUANTITY_TRACE'=>'Y','CAN_BUY_ZERO'=>'N','SUBSCRIBE'=>'N'];if($price){CatalogGateway::need(isset($this->profile['measures'][$price['unit']]),'CATALOG_MEASURE_NOT_MAPPED');$fields['MEASURE']=$this->profile['measures'][$price['unit']]['id'];}
        if($before['product'])self::result(\Bitrix\Catalog\Model\Product::update($id,$fields),'CATALOG_PRODUCT_UPDATE_FAILED');else self::result(\Bitrix\Catalog\Model\Product::add(['ID'=>$id]+$fields),'CATALOG_PRODUCT_ADD_FAILED');
        if(!$price){CatalogGateway::need(count($before['prices'])===0,'CATALOG_PRICE_REMOVAL_REQUIRES_REVIEW');return;}
        CatalogGateway::need(count($before['prices'])<=1&&count($before['ratios'])<=1,'CATALOG_NATIVE_PRICE_OR_RATIO_AMBIGUOUS');
        $pf=['PRODUCT_ID'=>$id,'CATALOG_GROUP_ID'=>$this->profile['price_group_id'],'PRICE'=>$price['decimal'],'CURRENCY'=>$price['currency'],'QUANTITY_FROM'=>null,'QUANTITY_TO'=>null];
        if($before['prices']){CatalogGateway::need($before['prices'][0]['CATALOG_GROUP_ID']===$this->profile['price_group_id'],'CATALOG_FOREIGN_PRICE_GROUP');self::result(\Bitrix\Catalog\Model\Price::update($before['prices'][0]['ID'],$pf),'CATALOG_PRICE_UPDATE_FAILED');}else self::result(\Bitrix\Catalog\Model\Price::add($pf),'CATALOG_PRICE_ADD_FAILED');
        // Product::add can create a default ratio. Read it before deciding add/update.
        $ratios=$this->data($id)['ratios'];CatalogGateway::need(count($ratios)<=1,'CATALOG_RATIO_AMBIGUOUS');$rf=['PRODUCT_ID'=>$id,'RATIO'=>$price['quantity_step'],'IS_DEFAULT'=>'Y'];if($ratios)self::result(\Bitrix\Catalog\MeasureRatioTable::update($ratios[0]['ID'],$rf),'CATALOG_RATIO_UPDATE_FAILED');else self::result(\Bitrix\Catalog\MeasureRatioTable::add($rf),'CATALOG_RATIO_ADD_FAILED');
    }
    public function write(array $item,array $before): void
    {
        $v=$item['value'];if($item['kind']==='category'){$s=new \CIBlockSection();$fields=['IBLOCK_ID'=>$this->iblock,'XML_ID'=>'upgrade:category:'.$item['key'],'NAME'=>$v['name'],'ACTIVE'=>'Y','IBLOCK_SECTION_ID'=>false];$ok=$before['section']?$s->Update($before['section']['id'],$fields):$s->Add($fields);CatalogGateway::need((bool)$ok,'CATALOG_CATEGORY_WRITE_FAILED');return;}
        $id=$before['page']['id'];$wanted=[];foreach($v['offers'] as $offer)$wanted[]='upgrade:offer:'.$offer['offer_key'];foreach(array_keys($before['offers']) as $old)CatalogGateway::need(in_array($old,$wanted,true),'CATALOG_OFFER_REMOVAL_REQUIRES_REVIEW');
        $this->writeNode($id,$v['offers']?\Bitrix\Catalog\ProductTable::TYPE_SKU:\Bitrix\Catalog\ProductTable::TYPE_PRODUCT,$v['price'],$before);
        \CIBlockElement::SetPropertyValuesEx($id,$this->iblock,[$this->profile['product_metadata_property_id']=>self::desiredMetadata($v)]);
        \CIBlockElement::SetElementSection($id,$this->wantedSections($v));
        foreach($v['offers'] as $offer){$xml='upgrade:offer:'.$offer['offer_key'];$old=$before['offers'][$xml]??null;if(!$old){$collision=self::rows(\CIBlockElement::GetList([],['IBLOCK_ID'=>$this->profile['offers_iblock_id'],'=XML_ID'=>$xml],false,['nTopCount'=>2],['ID']));CatalogGateway::need(!$collision,'CATALOG_OFFER_EXTERNAL_ID_COLLISION');$element=new \CIBlockElement();$offerId=$element->Add(['IBLOCK_ID'=>$this->profile['offers_iblock_id'],'XML_ID'=>$xml,'NAME'=>self::offerName($offer),'ACTIVE'=>'Y','PROPERTY_VALUES'=>[$this->profile['sku_property_id']=>$id]]);CatalogGateway::need((bool)$offerId,'CATALOG_OFFER_ADD_FAILED');$old=['product'=>null,'prices'=>[],'ratios'=>[]];}else{$offerId=$old['element']['id'];$element=new \CIBlockElement();CatalogGateway::need($element->Update($offerId,['NAME'=>self::offerName($offer),'ACTIVE'=>'Y']),'CATALOG_OFFER_UPDATE_FAILED');}$this->writeNode((int)$offerId,\Bitrix\Catalog\ProductTable::TYPE_OFFER,$offer['price'],$old);\CIBlockElement::SetPropertyValuesEx((int)$offerId,$this->profile['offers_iblock_id'],[$this->profile['offer_metadata_property_id']=>self::desiredMetadata($offer)]);}
    }
}
