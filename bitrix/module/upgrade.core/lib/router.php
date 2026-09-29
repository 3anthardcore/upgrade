<?php
declare(strict_types=1);
namespace Upgrade\Core;

final class Router
{
    public static function resolve(string $project,string $requestTarget): ?array
    {
        $db=\Bitrix\Main\Application::getConnection(); $sql=$db->getSqlHelper();
        $route=$db->query("SELECT r.*, e.BITRIX_ID,e.ENTITY_TYPE FROM ug_route r LEFT JOIN ug_entity e ON r.ENTITY_KEY=e.ENTITY_KEY AND r.PROJECT_ID=e.PROJECT_ID WHERE r.PROJECT_ID='".$sql->forSql($project)."' AND r.ROUTE_KEY='".hash('sha256',$requestTarget)."'")->fetch();
        // Hash lookup is indexed. Exact comparison retains case, encoded slash, repeated query values and ordering.
        return $route && hash_equals($route['REQUEST_TARGET'],$requestTarget)?$route:null;
    }
    public static function navigation(string $project,int $limit=12): array
    {
        $db=\Bitrix\Main\Application::getConnection(); $sql=$db->getSqlHelper();
        $rows=$db->query("SELECT r.REQUEST_TARGET,e.BITRIX_ID FROM ug_route r INNER JOIN ug_entity e ON r.ENTITY_KEY=e.ENTITY_KEY AND r.PROJECT_ID=e.PROJECT_ID WHERE r.PROJECT_ID='".$sql->forSql($project)."' AND r.STATUS=200 ORDER BY r.REQUEST_TARGET LIMIT ".max(1,min(100,$limit)));
        $links=[];
        while ($row=$rows->fetch()) { $item=\CIBlockElement::GetByID((int)$row['BITRIX_ID'])->Fetch(); if ($item && $item['ACTIVE']==='Y') { $links[]=['href'=>$row['REQUEST_TARGET'],'title'=>$item['NAME']]; } }
        return $links;
    }
    public static function content(int $id): ?array
    {
        $item=\CIBlockElement::GetByID($id)->Fetch();
        if (!$item||$item['ACTIVE']!=='Y') { return null; }
        $item['UPGRADE_PROPERTIES']=[];
        foreach (['UG_SEO_TITLE','UG_DESCRIPTION','UG_H1','UG_FACTS'] as $code) {
            $property=\CIBlockElement::GetProperty((int)$item['IBLOCK_ID'],$id,[],['CODE'=>$code])->Fetch();
            $item['UPGRADE_PROPERTIES'][$code]=(string)($property['VALUE']??'');
        }
        return $item;
    }
}
