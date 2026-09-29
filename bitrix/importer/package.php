<?php
declare(strict_types=1);
namespace Upgrade\Importer;

final class Package
{
    public static function target(string $target): void
    {
        if (strlen($target)>8192 || !str_starts_with($target,'/') || str_starts_with($target,'//') || preg_match('/[\x00-\x20\x7f#\\\\]/', $target)) { throw new \RuntimeException('INVALID_REQUEST_TARGET'); }
        $path = explode('?', $target, 2)[0];
        if (preg_match('/%(?![a-fA-F0-9]{2})/', $path)) { throw new \RuntimeException('INVALID_PERCENT_ENCODING'); }
        $decoded = rawurldecode($path);
        if (preg_match('/[\x00-\x1f\\\\]/', $decoded) || in_array('..',explode('/',$decoded),true) || in_array('.',explode('/',$decoded),true)) { throw new \RuntimeException('UNSAFE_ROUTE'); }
        if (preg_match('~^/(bitrix|local|upload|\.well-known)(/|$)~i',$decoded) || $decoded==='/robots.txt') { throw new \RuntimeException('RESERVED_ROUTE_COLLISION'); }
    }
    public static function read(string $dir, string $project, string $expectedHash): array
    {
        $root = realpath($dir);
        if (!$root || !is_dir($root) || is_link($dir) || !preg_match('/^[a-z0-9][a-z0-9-]{0,62}$/',$project)) { throw new \RuntimeException('PACKAGE_DIRECTORY_INVALID'); }
        $manifestFile = $root.'/manifest.json';
        if (!preg_match('/^[a-f0-9]{64}$/',$expectedHash) || !hash_equals($expectedHash,(string)hash_file('sha256',$manifestFile))) { throw new \RuntimeException('MANIFEST_HASH_MISMATCH'); }
        $manifest = json_decode((string)file_get_contents($manifestFile),true,512,JSON_THROW_ON_ERROR);
        if (($manifest['schema_version']??'')!=='1.0' || ($manifest['project_id']??'')!==$project || ($manifest['mode']??'')!=='public-demo' || ($manifest['target_profile']??'')!=='editable-content-snapshot') { throw new \RuntimeException('SCHEMA_OR_PROJECT_MISMATCH'); }
        if (!is_array($manifest['files']??null) || !isset($manifest['files']['data/entities.json'],$manifest['files']['data/routes.json'],$manifest['files']['data/assets.json']) || !is_array($manifest['blockers']??null)) { throw new \RuntimeException('MANIFEST_INVALID'); }
        $iterator=new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root,\FilesystemIterator::SKIP_DOTS),\RecursiveIteratorIterator::SELF_FIRST);
        foreach ($iterator as $entry) {
            if ($entry->isLink()) { throw new \RuntimeException('PACKAGE_SYMLINK'); }
            if ($entry->isDir()) { continue; }
            $name=str_replace(DIRECTORY_SEPARATOR,'/',substr($entry->getPathname(),strlen($root)+1));
            if (!$entry->isFile()||($name!=='manifest.json'&&!array_key_exists($name,$manifest['files']))) { throw new \RuntimeException('UNLISTED_PACKAGE_FILE:'.$name); }
        }
        foreach ($manifest['files'] as $path=>$hash) {
            if (!preg_match('~^[a-zA-Z0-9_./-]+$~',$path) || str_starts_with($path,'/') || array_intersect(explode('/',$path),['..','.','']) || !preg_match('/^[a-f0-9]{64}$/',$hash)) { throw new \RuntimeException('UNSAFE_PACKAGE_PATH'); }
            $file = realpath($root.'/'.$path);
            if (!$file || !str_starts_with($file,$root.DIRECTORY_SEPARATOR) || is_link($root.'/'.$path) || !is_file($file) || filesize($file)>200000000 || !hash_equals($hash,(string)hash_file('sha256',$file))) { throw new \RuntimeException('PACKAGE_HASH_OR_PATH_MISMATCH'); }
        }
        $entities = json_decode((string)file_get_contents($root.'/data/entities.json'),true,512,JSON_THROW_ON_ERROR);
        $routes = json_decode((string)file_get_contents($root.'/data/routes.json'),true,512,JSON_THROW_ON_ERROR);
        $assets = json_decode((string)file_get_contents($root.'/data/assets.json'),true,512,JSON_THROW_ON_ERROR);
        $assetHashes=[]; $extensions=['image/png'=>'png','image/jpeg'=>'jpg','image/gif'=>'gif','image/webp'=>'webp','image/avif'=>'avif','application/pdf'=>'pdf'];
        if (!is_array($assets)) { throw new \RuntimeException('ASSET_SCHEMA_INVALID'); }
        foreach ($assets as $asset) {
            if (!isset($extensions[$asset['mime']??''])||!preg_match('/^[a-f0-9]{64}$/',$asset['sha256']??'')) { throw new \RuntimeException('ASSET_SCHEMA_INVALID'); }
            $name=$asset['sha256'].'.'.$extensions[$asset['mime']];
            if (($asset['path']??'')!=='assets/'.$name || ($asset['public_path']??'')!=='/upload/upgrade/'.$project.'/'.$name || ($manifest['files'][$asset['path']]??'')!==$asset['sha256']) { throw new \RuntimeException('ASSET_PATH_OR_HASH_INVALID'); }
            $mime=(new \finfo(FILEINFO_MIME_TYPE))->file($root.'/'.$asset['path']);
            if ($mime!==$asset['mime']) { throw new \RuntimeException('ASSET_CONTENT_MIME_MISMATCH'); }
            $assetHashes[$asset['sha256']]=$asset;
        }
        if (!is_array($entities)||!is_array($routes)||count($entities)!==($manifest['entity_count']??-1)||count($routes)!==($manifest['route_count']??-1)) { throw new \RuntimeException('PACKAGE_COUNTS_INVALID'); }
        $keys=[]; $ids=[];
        foreach ($entities as $entity) {
            foreach (['source_id','type','title','stable_key'] as $field) { if (!is_string($entity[$field]??null)||$entity[$field]==='') { throw new \RuntimeException('ENTITY_SCHEMA_INVALID'); } }
            $key = hash('sha256',json_encode([$project,$entity['type'],$entity['source_id']],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_LINE_TERMINATORS|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
            if (!hash_equals($key,$entity['stable_key']) || isset($keys[$key]) || isset($ids[$entity['source_id']])) { throw new \RuntimeException('ENTITY_IDENTITY_INVALID'); }
            if (!in_array($entity['type'],['page','home','service','article','contact','contacts','category','search','not-found','product','section'],true)) { throw new \RuntimeException('ENTITY_TYPE_UNSUPPORTED'); }
            if (mb_strlen($entity['title'])>255 || !is_array($entity['blocks']??null)) { throw new \RuntimeException('ENTITY_FIELDS_INVALID'); }
            foreach ($entity['blocks'] as $block) {
                if (!is_array($block)||!in_array($block['type']??'',['paragraph','heading','list','table','quote','image','document'],true)) { throw new \RuntimeException('CONTENT_BLOCK_UNSUPPORTED'); }
                if (in_array($block['type'],['image','document'],true)&&!isset($assetHashes[$block['asset_sha256']??''])) { throw new \RuntimeException('CONTENT_ASSET_MISSING'); }
            }
            $keys[$key]=true; $ids[$entity['source_id']]=true;
        }
        $seen=[]; $redirects=[];
        foreach ($routes as $route) {
            if (!is_string($route['request_target']??null)||!is_string($route['route_key']??null)) { throw new \RuntimeException('ROUTE_SCHEMA_INVALID'); }
            self::target($route['request_target']);
            if (!hash_equals(hash('sha256',$route['request_target']),$route['route_key']) || isset($seen[$route['request_target']]) || !in_array($route['expected_status']??0,[200,301,302,307,308,404,410],true)) { throw new \RuntimeException('ROUTE_INTEGRITY_FAILURE'); }
            if ($route['expected_status']===200 && !isset($keys[$route['entity_key']??''])) { throw new \RuntimeException('ROUTE_ENTITY_MISSING'); }
            if ($route['expected_status']>=300 && $route['expected_status']<400) { self::target((string)($route['redirect_target']??'')); $redirects[$route['request_target']]=$route['redirect_target']; }
            $seen[$route['request_target']]=true;
        }
        foreach ($redirects as $start=>$destination) { $visited=[$start=>true]; while (isset($redirects[$destination])) { if (isset($visited[$destination])) { throw new \RuntimeException('REDIRECT_LOOP'); } $visited[$destination]=true; $destination=$redirects[$destination]; } }
        return ['manifest'=>$manifest,'entities'=>$entities,'routes'=>$routes,'assets'=>$assets,'asset_index'=>$assetHashes,'root'=>$root,'manifest_hash'=>$expectedHash];
    }
}
