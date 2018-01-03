# redis-acl
Access control list with redis - user roles and access management

# redis-acl
Access control list with redis - user roles and access management

This module provides an ACL implementation providing following features.

## Features

- Add / Remove resources
	+ Create resource hierarchies
- Add Roles
- Add Tasks
- Allow / Remove User's resource access
- Get user roles for resources
- Check user access for particular resource's to perform a task


## Installation

Using npm:

```javascript
npm install redis-acl
```

## Documentation

* [addResource](#addResource)
* [addChildResource](#addChildResource)
* [deleteResource](#deleteResource)
* [addRole](#addRole)
* [addTask](#addTask)
* [allowResourceAccess](#allowResourceAccess)
* [removeResourceAccess](#removeResourceAccess)
* [getRole](#getRole)
* [checkAccess](#checkAccess)

## Examples

Create your acl module by requiring it and instantiating it with redis instance details:

```javascript
let acl = require('redis-acl');

// Connect with redis instance
let redisConnectionConf = {
	"host": "127.0.0.1",
	"port": 6379
};
acl = new acl(redisConnectionConf);


All the following functions take a callback with an err and response parameters as last parameter.

Add resources:

```javascript
// add new resource
acl.addResource("blogs",(err, res)=>{});

// add child resource and create resource hierarhy
// creating child resource implicitly creates parents
acl.addChildResource("blogs", "tech-blogs", (err, res)=>{});

acl.addChildResource("tech-blogs", "device-reviews", (err, res)=>{});

acl.addChildResource("tech-blogs", "os-reviews", (err, res)=>{});
```

Delete resource:

```javascript
// second parameter decides whether to keep hierarchy intact or to delete resource's children too
// keep hierarchy 
acl.deleteResource("blogs", true, (err, res)=>{
    // this will only delete "blogs" resource and its children ("tech-reviews", "os-reviews") will be attached to root parent
});

// delte hierarchy
acl.deleteResource("blogs", false, (err, res)=>{
    // this will delete entire hierarchy below "blogs" resource i.e its children and their children(if any)
});
```

Add Role(s):

```javascript
acl.addRole("admin", (err, res)=>{});
```

Add allowed task(s) to role(s): 

```javascript
// adding tasks to roles implicitly creates roles
acl.addTask("admin", ["view","modify","delete"], (err, res)=>{});
```

Allow user to access a resource(s) with a role(s):

```javascript
// It gives access to resources and its children with same roles.
acl.allowResourceAccess("david", "device-reviews", ["admin"], (err, res)=>{});
```

Remove user's role to access a resource(s):

```javascript
// this will remove user's mentioned role for mentioned resource(s)
removeResourceAccess("david","device-reviews","admin",(err, res)=>{});
```

Get user roles for resource:

```javascript
acl.getRole("david", "device-reviews", (err, res)=>{
    // this will return an array of available roles
    // res => ["admin"]
})
```
Check user's access to perform a task on a resource:

```javascript
acl.checkAccess("david", "device-reviews", "modify", (err, res)=>{
    // this will return a boolean value true / false
    // res => true
});
```

## Methods

<a name="addResource"/>

### addResource( resource, function(err) )

Adds new parent resources.

__Arguments__

```javascript
    resource   {String|Number} Resource.
    callback {Function} Callback called when finished.
```

---------------------------------------

<a name="addChildResource"/>

### addChildResource( parentResource , childResource(s), function(err) )

Adds child resource(s) to another resource.

__Arguments__

```javascript
    parentResource   {String|Number} Parent resource.
    childResource    {String|Number|Array[String|Number]} Child resources to add.
    callback {Function} Callback called when finished.
```

---------------------------------------

<a name="deleteResource" />

### deleteResource( resource, keepHierarchy, function(err, roles) )

Deletes a resource with or without its entire children hierarchy.

__Arguments__

```javascript
    resource   {String|Number} Resource.
    keepHierarchy {Boolean} Boolean identifier to indicate whether to keep children hierarchy intact or to delete it.
    callback {Function} Callback called when finished.
```

---------------------------------------

<a name="addRole" />

### addRole( role, function(err, users) )

Adds new role.

__Arguments__

```javascript
    role   {String|Number|Array[String|Number]} Role.
    callback {Function} Callback called when finished.
```

---------------------------------------

<a name="addTask" />

### addTask( roles, tasks, function(err, hasRole) )

Add allowed task(s) to role(s).

__Arguments__

```javascript
    roles   {String|Number|Array[String|Number]} roles.
    tasks {String|Number|Array[String|Number]} tasks.
    callback {Function} Callback called when finished.
```

---------------------------------------

<a name="allowResourceAccess" />

### allowResourceAccess( user, resource, roles, function(err) )

Allows user to access mentioned resource with mentioned role(s).

__Arguments__

```javascript
    user     {String|Number} user.
    resource {String|Numebr} resource
    roles  {String|Array|Array[String|Number]} roles.
    callback {Function} Callback called when finished.
```

---------------------------------------

<a name="removeResourceAccess" />

### removeResourceAccess( user, resource, roles, function(err) )

Removes user's access for mentioned resource for mentined roles.

__Arguments__

```javascript
    user     {String|Number} user.
    resource {String|Numebr} resource.
    roles  {String|Array|Array[String|Number]} roles.
    callback {Function} Callback called when finished [optional].
```

---------------------------------------

<a name="getRole" />

### getRole( user, resource, function(err) )

Returns list of available roles of user for mentioned resource.

__Arguments__

```javascript
    user     {String|Number} user.
    resource {String|Numebr} resource.
    callback {Function} Callback called when finished.
```

---------------------------------------

<a name="checkAccess" />
### checkAccess( user, resource, task, function(err) )

Checks user's access to perform mentioned task on mentioned resource

__Arguments__

```javascript
    user     {String|Number} user.
    resource {String} resource.
    task     {String|Number} task.
    callback {Function} Callback called when finished.
```

---------------------------------------

## Future work

- Support for diffrent roles for inherited access.
