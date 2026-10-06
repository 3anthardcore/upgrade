<?php
declare(strict_types=1);
namespace Upgrade\Core;

/** Read only a root-pinned private snapshot; request input cannot select a release. */
final class DemoRuntime
{
    public static function handle(DemoEngine $engine,array $snapshot,array $request,string $privateRoot): array
    {
        // One bounded host-local admission gate prevents concurrent new sessions
        // from racing the quota. Existing receipts are retained, never evicted.
        $project=$snapshot['project_id'];$directory=$privateRoot.'/demo-'.$project;
        if(!is_dir($directory)||is_link($directory)||is_link($privateRoot.'/admission.lock'))throw new \RuntimeException('DEMO_ADMISSION_PATH');
        $readAttemptRequiresWrite=false;
        if(in_array($request['method']??null,['GET','HEAD'],true)){
            // No route/cookie existence shortcut: the engine itself forbids every
            // create/save in this attempt, including fallback for a missing session.
            try{return DemoWeb::handle($engine->readOnlyCopy(),$snapshot,$request);}
            catch(DemoAdmissionRequired){$readAttemptRequiresWrite=true;}
        }
        $gate=fopen($privateRoot.'/admission.lock','c+b');if(!$gate)throw new \RuntimeException('DEMO_ADMISSION_LOCK');chmod($privateRoot.'/admission.lock',0600);
        $deadline=hrtime(true)+3000000000;
        while(!flock($gate,LOCK_EX|LOCK_NB)){if(hrtime(true)>$deadline){fclose($gate);throw new \RuntimeException('DEMO_ADMISSION_BUSY');}usleep(10000);}
        try{
            $bytes=0;$sessions=0;$files=0;
            foreach(new \FilesystemIterator($directory,\FilesystemIterator::SKIP_DOTS) as $file){
                if(++$files>5000)throw new \RuntimeException('DEMO_STATE_FILE_QUOTA');
                if($file->isLink()||!$file->isFile())throw new \RuntimeException('DEMO_STATE_PATH');
                $bytes+=$file->getSize();if(str_ends_with($file->getFilename(),'.json'))$sessions++;
            }
            $cookie=$request['cookie']??null;
            // A failed read-only attempt always reserves room for creation, even if
            // an old cookie's file has appeared again while waiting for admission.
            $known=!$readAttemptRequiresWrite&&is_string($cookie)&&preg_match('/\A[a-f0-9]{64}\z/D',$cookie)&&is_file($directory.'/'.hash('sha256',$project."\0".$cookie).'.json');
            // Keep the ceiling valid during the atomic write, including failure residue.
            // New: lock + pending/committed JSON. Existing: one pending JSON beside the old one.
            if($files+($known?1:2)>5000)throw new \RuntimeException('DEMO_STATE_FILE_QUOTA');
            if(!$known&&$sessions>=1000)throw new \RuntimeException('DEMO_SESSION_QUOTA');
            if((!$known||($request['method']??'')==='POST')&&$bytes+8388608>134217728)throw new \RuntimeException('DEMO_STATE_QUOTA');
            return DemoWeb::handle($engine,$snapshot,$request);
        }finally{flock($gate,LOCK_UN);fclose($gate);}
    }
    public static function snapshot(string $project,string $stateRoot): ?array
    {
        $root=realpath($stateRoot);
        $webroot=realpath($_SERVER['DOCUMENT_ROOT']??'');
        if (!$root||is_link($stateRoot)||($webroot&&($root===$webroot||str_starts_with($root,$webroot.DIRECTORY_SEPARATOR)))) throw new \RuntimeException('DEMO_PRIVATE_ROOT_REQUIRED');
        $pointer=$root.'/demo-active.json';
        if(!file_exists($pointer)) return null;
        if(is_link($pointer)||!is_file($pointer)||filesize($pointer)>4096) throw new \RuntimeException('DEMO_POINTER_INVALID');
        $config=json_decode((string)file_get_contents($pointer),true,16,JSON_THROW_ON_ERROR);
        if(($config['schema_version']??null)!==1||($config['project_id']??null)!==$project||($config['target_id']??null)!==getenv('UPGRADE_TARGET_ID')||!preg_match('/\A[a-f0-9]{64}\z/D',$config['sha256']??'')||!preg_match('/\A[a-zA-Z0-9_-]+\/data\/demo-snapshot\.json\z/D',$config['relative_path']??'')) throw new \RuntimeException('DEMO_POINTER_BINDING');
        $candidate=$root.DIRECTORY_SEPARATOR.str_replace('/',DIRECTORY_SEPARATOR,$config['relative_path']);$path=realpath($candidate);
        if(!$path||!str_starts_with($path,$root.DIRECTORY_SEPARATOR)||$path!==$candidate||is_link($candidate)||!is_file($path)||filesize($path)>67108864) throw new \RuntimeException('DEMO_SNAPSHOT_PATH');
        $bytes=(string)file_get_contents($path);
        if(!hash_equals($config['sha256'],hash('sha256',$bytes))) throw new \RuntimeException('DEMO_SNAPSHOT_HASH');
        $snapshot=json_decode($bytes,true,128,JSON_THROW_ON_ERROR);
        if(($snapshot['schema_version']??null)!==1||($snapshot['project_id']??null)!==$project||!preg_match('/\A[a-f0-9]{64}\z/D',$snapshot['snapshot_id']??'')) throw new \RuntimeException('DEMO_SNAPSHOT_BINDING');
        return $snapshot;
    }
}
