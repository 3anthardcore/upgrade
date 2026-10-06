<?php
declare(strict_types=1);
namespace Upgrade\Core;

/** Preserve the own request and give the CMS no user-controlled action inputs. */
final class DemoTransport
{
    public static function capture(array $server,string $body): array
    {
        $method=$server['REQUEST_METHOD']??'GET';
        $target=$server['REQUEST_URI']??'/';
        if(!is_string($target)||strlen($target)>8192||!str_starts_with($target,'/')||str_starts_with($target,'//')||preg_match('/[\x00-\x20\x7f\\\\#]/',$target))throw new \RuntimeException('REQUEST_INVALID',400);
        if(!in_array($method,['GET','HEAD','POST'],true))throw new \RuntimeException('METHOD_INVALID',405);
        if(strlen($body)>8192||($method!=='POST'&&$body!==''))throw new \RuntimeException('BODY_INVALID',400);
        $host=$server['HTTP_HOST']??'';$https=($server['HTTPS']??'')==='on';
        $origin=$server['UPGRADE_ORIGIN']??null;$contentType=$server['CONTENT_TYPE']??'';
        if(!is_string($host)||!preg_match('/\A[a-zA-Z0-9.-]+(?::[0-9]{1,5})?\z/D',$host))throw new \RuntimeException('HOST_INVALID',400);
        if($method==='POST'){
            if($target!=='/__upgrade/action')throw new \RuntimeException('ACTION_TARGET_INVALID',405);
            if(!is_string($contentType)||!preg_match('/\Aapplication\/x-www-form-urlencoded(?:\s*;\s*charset=UTF-8)?\z/Di',$contentType))throw new \RuntimeException('CONTENT_TYPE_INVALID',415);
            if(!is_string($origin)||!hash_equals(($https?'https':'http').'://'.$host,$origin))throw new \RuntimeException('ORIGIN_INVALID',403);
        }
        $cookies=[];foreach(explode(';',(string)($server['UPGRADE_COOKIE_HEADER']??'')) as $part){$pair=explode('=',trim($part),2);if($pair[0]==='upgrade_demo_session')$cookies[]=$pair[1]??'';}
        return ['method'=>$method,'request_target'=>$target,'host'=>$host,'https'=>$https,'origin'=>$origin,
            'cookie'=>count($cookies)===1?$cookies[0]:(count($cookies)>1?'invalid-duplicate-cookie':null),
            'body'=>$body,'content_type'=>$contentType];
    }

    public static function isolateGlobals(): void
    {
        // This is called before the first CMS include. The exact request survives
        // only in the own capture; vendor auth/registration handlers see no form.
        $_GET=[];$_POST=[];$_REQUEST=[];$_COOKIE=[];$_FILES=[];
        foreach(['HTTP_COOKIE','HTTP_AUTHORIZATION','REDIRECT_HTTP_AUTHORIZATION','PHP_AUTH_USER','PHP_AUTH_PW','PHP_AUTH_DIGEST','AUTH_TYPE','CONTENT_TYPE','CONTENT_LENGTH','PATH_INFO','ORIG_PATH_INFO','REDIRECT_QUERY_STRING','UPGRADE_COOKIE_HEADER','UPGRADE_ORIGIN'] as $key)unset($_SERVER[$key]);
        $_SERVER['REQUEST_METHOD']='GET';
        $_SERVER['REQUEST_URI']='/local/upgrade-route.php';
        $_SERVER['QUERY_STRING']='';
    }
}
