'use strict';
const Redis = require('redis');
const async = require('neo-async');
let redis;

//if parent is assigned a resource with a role, this mapping will be used to assign resource's children roles for user.
const parentRoleToChildRoleMapping = {};

function connect(conf){
	//conf will have  redis host and port
	if(!conf)
		conf = {
			"host": "127.0.0.1",
			"port": 6379
		};
	redis = Redis.createClient(conf);
}

connect.prototype.addResource = addResource;
connect.prototype.addChildResource = addChildResource;
connect.prototype.deleteResource = deleteResource;

connect.prototype.allowResourceAccess = allowResourceAccess;
connect.prototype.removeResourceAccess = removeResourceAccess;

connect.prototype.addRole = addRole;
connect.prototype.addTask = addTask;

connect.prototype.getRole = getRole;
connect.prototype.checkAccess = checkAccess;

function getChildRoles(parentRoles){
	//will return role of a user for children organisations
	if(!Array.isArray(parentRoles))
		parentRoles = [parentRoles];
	let childRoles = [];
	for(let role of parentRoles){
		if(parentRoleToChildRoleMapping[role])
			childRoles.push(parentRoleToChildRoleMapping[role]);
		else childRoles.push(role);		
	}
	return childRoles;
}

function addResource(resourceId, callback){
	//will add new root resource
	const rootKey = "resources:children";
	const pipeline = redis.multi();
	pipeline.sadd(rootKey, resourceId);
	pipeline.sadd(resourceId + ":parents", "resources");
	pipeline.exec((err, res)=>{
		if(err)
			return handleError(err, callback);
		return callback(null, res);
	});
}

function addChildResource(parentId, childId, callback){
	//check if parent is present
	const superParentsKey = parentId + ":parents";
	redis.exists(superParentsKey, (err, res)=>{
		if(err)
			return handleError(err, callback);
		if(!res)
			addResource(parentId,(err, res)=>{
				if(err)
					return handleError(err, callback);
				return addChild(parentId, childId, callback);
			});
		else return addChild(parentId, childId, callback);
	});
}

function addChild(parentId, childId, callback){
	//will add child to parent organisation
	const childrenKey = parentId + ":children";
	const parentKey = childId + ":parents";

	const pipeline = redis.multi();
	pipeline.sadd(childrenKey, childId);
	pipeline.sadd(parentKey, parentId);
	pipeline.exec((err, res)=>{
		if(err)
			return handleError(err, callback);
		getMembersRecursive(parentId)((err, members)=>{
			if(err){
				//error already logged
				return callback(err, null);
			}

			if(!members.length)
				return callback(null, res);

			const pipeline = redis.multi();
			//get user roles for parent organisation
			for(let member of members)
				pipeline.smembers(member + ":" + parentId);

			pipeline.exec((err, memberParentRoles)=>{
				if(err)
					return handleError(err, callback);
				const pipeline = redis.multi();
				//set user roles for child organisation
				for(let i in members)
					pipeline.sadd(members[i] + ":" + childId, getChildRoles(memberParentRoles[i]));
		
				pipeline.exec((err, res)=>{
					if(err)
						return handleError(err, callback);
					return callback(null, res);
				});
			});
		});
	});
}

function deleteHierarchy(resourceId, callback){
	//will get all children
	getChildrenRecursive(resourceId)((err, children)=>{
		if(err)
			return handleError(err, callback);

		//will get all parental members
		getMembersRecursive(resourceId)((err, allMembers)=>{
			if(err)
				return handleError(err, callback);

			const parentKey = resourceId + ":parents";

			//will get current resouce's parents to remove links
			redis.smembers(parentKey, (err, parents)=>{
				if(err)
					return handleError(err, callback);
				
				const pipeline = redis.multi();
				//delete all current and children resource IDs from all effective members
				for(let member of allMembers){
					//remove current resource access
					pipeline.del(member + ":" + resourceId);

					//remove children resource access
					for(let child of children)
						pipeline.del(member + ":" + child);
				}

				//remove resource from it's parents
				for(let parent of parents)
					pipeline.srem(parent + ":children", resourceId);

				//get assigned mebers of children
				children.push(resourceId);
				for(let child of children)
					pipeline.smembers(child + ":members");

				pipeline.exec((err, results)=>{
					if(err)
						return handleError(err, callback);
					
					const assignedChildMembers = results.slice(results.length - children.length);
					let allChildMembers = [];

					for(let memberSet of assignedChildMembers)
						allChildMembers = allChildMembers.concat(memberSet);

					const pipeline = redis.multi();

					//remove children resource entries
					for(let i in children){
						//member key
						pipeline.del(children[i] + ":members");
						//children key
						pipeline.del(children[i] + ":children");
						//parents key
						pipeline.del(children[i] + ":parents");

						for(let member of assignedChildMembers[i])
							pipeline.del(children[i] + ":memberAssignedRoles:" + member);

						for(let member of allChildMembers)
							pipeline.del(member + ":" + children[i]);
					}
					

					pipeline.exec((err, res)=>{
						if(err)
							return handleError(err, callback);
						return callback(null, res);
					});
				});
			});
		});
	});
}

function deleteAndKeepHierarchy(resourceId, callback){
	//will get all parental members to remove access
	getMembersRecursive(resourceId)((err, allMembers)=>{
		if(err)
			return handleError(err, callback);
		
		//get children resources
		const childrenKey = resourceId + ":children";
		//get parents
		const parentKey = resourceId + ":parents";
		const memberKey = resourceId + ":members";

		const pipeline = redis.multi();
		pipeline.smembers(childrenKey);
		pipeline.smembers(parentKey);
		pipeline.smembers(memberKey);
		pipeline.exec((err, results)=>{
			if(err)
				return handleError(err, callback);	

			const children = results[0];
			const parents = results[1];
			const members = results[2];
			
			const pipeline = redis.multi();
			//remove access of resource from all affecting members
			for(let member of allMembers)
				pipeline.del(member + ":" + resourceId);
			
			//attach all resource's children to resource's parents to maintain hierarchy
			for(let parent of parents){
				pipeline.srem(parent + ":children", resourceId);
				if(children.length)
					pipeline.sadd(parent + ":children", children);
			}

			//attach all resource's parents to resource's children to maintain hierarchy
			for(let child of children){
				pipeline.sadd(child + ":parents", parents);
				pipeline.srem(child + ":parents", resourceId);
				//attach resource's members to children
				if(members.length)
					pipeline.sadd(child + ":members", members);
			}
			//remove resource
			pipeline.del(childrenKey);
			pipeline.del(parentKey);
			pipeline.del(memberKey);
			for(let member of members)
				pipeline.smembers(resourceId + ":memberAssignedRoles:" + member);

			pipeline.exec((err, res)=>{
				if(err)
					return handleError(err, callback);

				const memberAssignedRoles = res.slice(res.length - members.length);

				const pipeline = redis.multi();
				for(let i in members){
					pipeline.del(resourceId + ":memberAssignedRoles:" + members[i]);
					for(let child of children)
						pipeline.sadd(child + ":memberAssignedRoles:" + members[i], getChildRoles(memberAssignedRoles[i]));
				}
				pipeline.exec((err, res)=>{
					if(err)
						return handleError(err, callback);
					return callback(null, res);
				});
			});
		});
	});
}

function deleteResource(resourceId, keepHierarchy, callback){
	//will delete resource and remove user access 
	if(!keepHierarchy)
		return deleteHierarchy(resourceId, callback);
	return deleteAndKeepHierarchy(resourceId, callback);
}

function getMembersRecursive(parentId){
	return function(callback){
		//will return list of children
		const memberKey = parentId + ":members";
		const superParentKey = parentId + ':parents';
		const pipeline = redis.multi();
		pipeline.smembers(memberKey);
		pipeline.smembers(superParentKey);
		pipeline.exec((err, results)=>{
			if(err)
				return handleError(err, callback);
			let members = results[0];
			const parents = results[1];
			if(!parents.length)
				return callback(null, members);
			//get hierarchical parent members
			// const pipeline = redis.multi();
			const getMembersFuncArr = [];
			for(let parent of parents)
				getMembersFuncArr.push(getMembersRecursive(parent));
			async.parallel(getMembersFuncArr, (err, res)=>{
				if(err)
					return handleError(err, callback);
				for(let item of res)
					members = members.concat(item);
				return callback(null, members);
			});
		});		
	}
}

function getChildrenRecursive(parentId){
	return function(callback){
		//will return list of children
		const childrenKey = parentId + ":children";
		redis.smembers(childrenKey, (err, children)=>{
			if(err)
				return handleError(err, callback);
			if(!children.length)
				return callback(null, []);
			//will get grand children
			const pipeline = redis.multi();
			for(let child of children)
				pipeline.smembers(child + ":children");
			
			pipeline.exec((err, results)=>{
				if(err)
					return handleError(err, callback);
				const getChildrenFuncArr = [];
				for(let item of results){
					if(item.length){
						children = children.concat(item);
						for(let i of item)
							getChildrenFuncArr.push(getChildrenRecursive(i));
					}
				}
				async.parallel(getChildrenFuncArr, (err, results)=>{
					if(err)
						return handleError(err, callback);
					for(let item of results)
						children = children.concat(item);
					return callback(null, children);
				});
			});
		});		
	}
}

function getChildren(parentId, callback){
	//will return list of children
	const childrenKey = parentId + ":children";
	redis.smembers(childrenKey, (err, children)=>{
		if(err)
			return handleError(err, callback);
		return callback(null, children);
	});
}

function handleError(err, callback){
	//log error
	console.log(err);
	return callback(err, null);	
}

function updateRoleRecursive(userId, resourceId, roleIds){
	return function(callback){
		//will update a role of user for particular organisation and its children
		const userIdKey = "user:" + userId;
		getChildren(resourceId, (err, children)=>{
			if(err){
				//error already logged
				return callback(err, null);
			}
			//if no children for current organisation -> return completed
			if(!children.length){
			 	return redis.sadd(userIdKey + ":" + resourceId, roleIds, (err, res)=>{
					if(err)
						return handleError(err, callback);
					return callback(null, res);
				});
			}

			const pipeline = redis.multi();
			const recursiveFunctionsArr = [];
			//set role for current organisation
			pipeline.sadd(userIdKey + ":" + resourceId, roleIds);
			const childRoles = getChildRoles(roleIds);
			//set user roles for child organisation
			for(let child of children){
				pipeline.sadd(userIdKey + ":" + child, childRoles);
				recursiveFunctionsArr.push(updateRoleRecursive(userId, child, childRoles));
			}
			pipeline.exec((err, res)=>{
				if(err)
					return handleError(err, callback);
				// role updatetion for current organisation is done lets do it for children organisations
				async.parallel(recursiveFunctionsArr, (err, res)=>{
					if(err)
						return handleError(err, callback);
					return callback(null, res);
				});
			});
		});		
	}
}

function allowResourceAccess(userId, resourceId, roleIds, callback){
	//will add user to members list of resource
	const memberKey = resourceId + ":members";
	const pipeline = redis.multi();
	const rolesKey = "roles:chlidren";
	pipeline.sadd(memberKey, "user:" + userId);
	pipeline.sadd(rolesKey, roleIds);
	//update originally assigned member role
	pipeline.sadd(resourceId + ":memberAssignedRoles:user:" + userId, roleIds);
	pipeline.exec((err, res)=>{
		if(err)
			return handleError(err, callback);
		return updateRoleRecursive(userId, resourceId, roleIds)(callback);
	});
}

function updateResourceAccess(userId, resourceId, roleIds, callback){
	//update originally assigned member role
	const rolesKey = "roles:chlidren";
	const pipeline = redis.multi();
	pipeline.sadd(rolesKey, roleIds);
	pipeline.sadd(resourceId + ":memberAssignedRoles:user:" + userId, roleIds);
	pipeline.exec((err, res)=>{
		if(err)
			return handleError(err, callback);
		return updateRoleRecursive(userId, resourceId, roleIds)(callback);		
	});
}

function removeResourceAccess(userId, resourceId, roleIds, callback){
	const memberKey = resourceId + ":members";
	const userIdKey = "user:" + userId;
	getChildrenRecursive(resourceId)((err, children)=>{
		if(err)
			return handleError(err, callback);

		const pipeline = redis.multi();		
		//will get resource's children members and remove resource access
		pipeline.srem(memberKey, userIdKey);
		pipeline.srem(userIdKey + ":" + resourceId, roleIds);
		pipeline.srem(resourceId + ":memberAssignedRoles:" + userIdKey, roleIds);

		for(let child of children){
			pipeline.smembers(child + ":members");
			pipeline.srem(userIdKey + ":" + child, getChildRoles(roleIds));
		}

		pipeline.exec((err, childMembers)=>{
			if(err)
				return handleError(err, callback);

			if(!children.length)
				return callback(null, true);
			childMembers = childMembers.slice(3);

			const roleUpdateNeededResources = [];
			const pipeline = redis.multi();

			for(let i = 0; i < childMembers.length; i++){
				if(childMembers[i].indexOf(userIdKey) !== -1){
					let child = children[i/2];
					roleUpdateNeededResources.push(child);
					pipeline.smembers(child + ":memberAssignedRoles:" + userIdKey);
				}
				++i;
			}
			if(!roleUpdateNeededResources.length)
				return callback(null, true);
			pipeline.exec((err, results)=>{
				if(err)
					return handleError(err, callback);
				const updateRoleFuncArr = [];
				for(let i in roleUpdateNeededResources)
					updateRoleFuncArr.push(updateRoleRecursive(userId, roleUpdateNeededResources[i], results[i]));
				async.parallel(updateRoleFuncArr, (err, res)=>{
					if(err)
						return handleError(err, callback);
					return callback(null, res);
				});
			});
		});

	});
}

function addRole(roleIds, callback){
	const rolesKey = "roles:chlidren";
	redis.sadd(rolesKey, roleIds, (err, res)=>{
		if(err)
			return handleError(err, callback);
		return callback(null, res);
	});
}

function addTask(roleIds, taskIds, callback){
	const rolesKey = "roles:chlidren";
	const pipeline = redis.multi();
	pipeline.sadd(roleIds);
	if(!Array.isArray(roleIds))
		roleIds = [roleIds];
	pipeline.sadd(rolesKey, roleIds);
	for(let role of roleIds)
		pipeline.sadd( role + ":tasks", taskIds);
	pipeline.exec((err, res)=>{
		if(err)
			return handleError(err, callback);
		return callback(null, res);
	});
}

function getRole(userId, resourceId, callback){
	//will return role of a user for particular organisation
	const userResourceKey = "user:" + userId + ":" + resourceId;
	redis.smembers(userResourceKey, (err, role)=>{
		if(err)
			return handleError(err, callback);
		return callback(null, role);
	});
}

function checkAccess(userId, resourceId, taskId, callback){
	getRole(userId, resourceId, (err, roles)=>{
		if(err){
			//logging already done
			return callback(err, null);
		}
		const pipeline = redis.multi();
		for(let role of roles)
			pipeline.sismember(role + ":tasks", taskId);
		pipeline.exec((err, results)=>{
			if(err)
				return handleError(err, callback);
			//check for access
			for(let result of results)
				if(result)
					return callback(null, true);
			// access if not present
			return callback(null, false);
		});
	});
}

module.exports = connect;

// addChildResource("m","b",()=>{
// 	addChildResource("b","x",()=>{})
// 	addChildResource("b","y",()=>{})
// 	allowResourceAccess(1, "b", ["role1"], ()=>{})
// 	allowResourceAccess(2, "m", ["role1"], ()=>{})
// })
// addChildResource("m","a",()=>{
// 	allowResourceAccess(3, "a", ["role1"], ()=>{})
// })
// allowResourceAccess(1, "m", "role1", ()=>{})
// allowResourceAccess(1, "a", "role1", ()=>{})
// removeResourceAccess(1,"m","role1",()=>{})
// assignResource(2, "l", "role1", ()=>{console.log(new Date())})
// assignResource(5, "d", "role1", ()=>{console.log(new Date())})
// assignResource(6, "e", "role1", ()=>{console.log(new Date())})
// assignResource(7, "f", "role1", ()=>{console.log(new Date())})
// assignResource(8, "g", "role1", ()=>{console.log(new Date())})
// assignResource(9, "i", "role1", ()=>{console.log(new Date())})
// assignResource(3, "b", "role1", ()=>{console.log(new Date())})
// updateResourceAccess( 1, "h","role10",()=>{});
// addResource("a", ()=>{});
// deleteResource("a", false, ()=>{})
// addRole("role2", ()=>{});
// addTask(["role1", "role2"], ["task1","task2"], ()=>{})
// getRole(1, "b", (err, e)=>{ console.log(err, e)})
// checkAccess(1, "b", "task1", function (){console.log(arguments)})